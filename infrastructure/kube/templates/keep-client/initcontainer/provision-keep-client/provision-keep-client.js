const fs = require('fs');
const toml = require('toml');
const tomlify = require('tomlify-j0.4');
const concat = require('concat-stream');
const Web3 = require('web3');

// ETH host info
const ethHost = process.env.ETH_HOSTNAME;
const ethWsPort = process.env.ETH_WS_PORT;
const ethRpcPort = process.env.ETH_RPC_PORT;
const ethNetworkId = process.env.ETH_NETWORK_ID;

/*
We override transactionConfirmationBlocks and transactionBlockTimeout because they're
25 and 50 blocks respectively at default.  The result of this on small private testnets
is long wait times for scripts to execute.
*/
const web3_options = {
    defaultBlock: 'latest',
    defaultGas: 4712388,
    transactionBlockTimeout: 25,
    transactionConfirmationBlocks: 3,
    transactionPollingTimeout: 480
};
const web3 = new Web3(new Web3.providers.HttpProvider(ethHost + ':' + ethRpcPort), null, web3_options);


/*
Each <contract.json> file is sourced directly from the InitContainer.  Files are generated by
Truffle during contract and copied to the InitContainer image via Circle.
*/

// StakingProxy
const stakingProxyContractJsonFile = '/tmp/StakingProxy.json';
const stakingProxyContractParsed = JSON.parse(fs.readFileSync(stakingProxyContractJsonFile));
const stakingProxyContractAbi = stakingProxyContractParsed.abi;
const stakingProxyContractAddress = stakingProxyContractParsed.networks[ethNetworkId].address;
const stakingProxyContract = new web3.eth.Contract(stakingProxyContractAbi, stakingProxyContractAddress);

// TokenStaking
const tokenStakingContractJsonFile = '/tmp/TokenStaking.json';
const tokenStakingContractParsed = JSON.parse(fs.readFileSync(tokenStakingContractJsonFile));
const tokenStakingContractAbi = tokenStakingContractParsed.abi;
const tokenStakingContractAddress = tokenStakingContractParsed.networks[ethNetworkId].address;
const tokenStakingContract = new web3.eth.Contract(tokenStakingContractAbi, tokenStakingContractAddress);

// KeepToken
const keepTokenContractJsonFile = '/tmp/KeepToken.json';
const keepTokenContractParsed = JSON.parse(fs.readFileSync(keepTokenContractJsonFile));
const keepTokenContractAbi = keepTokenContractParsed.abi;
const keepTokenContractAddress = keepTokenContractParsed.networks[ethNetworkId].address;
const keepTokenContract = new web3.eth.Contract(keepTokenContractAbi, keepTokenContractAddress);

// keepRandomBeacon, only contract address for config file create
const keepRandomBeaconJsonFile = '/tmp/KeepRandomBeacon.json';
const keepRandomBeaconParsed = JSON.parse(fs.readFileSync(keepRandomBeaconJsonFile));
const keepRandomBeaconContractAddress = keepRandomBeaconParsed.networks[ethNetworkId].address;

// KeepGroup, only contract address for config file create
const keepGroupJsonFile = '/tmp/KeepGroup.json';
const keepGroupParsed = JSON.parse(fs.readFileSync(keepGroupJsonFile));
const keepGroupContractAddress = keepGroupParsed.networks[ethNetworkId].address;

// Stake a target eth account
async function provisionKeepClient() {

  try {
    // If it's a bootstrap peer we assume existing account and use it accordingly.
    if (process.env.KEEP_CLIENT_TYPE === 'bootstrap') {
      console.log('###########  Provisioning keep-client Bootstrap Peer! ###########');
      console.log('\n<<<<<<<<<<<< Setting Up Operator Account ' + '>>>>>>>>>>>>');

      // Existing account is set on the bootstrap peer config template, we rip it out of that.
      let bootstrapConfigFile = toml.parse(fs.readFileSync('/tmp/keep-client-bootstrap-peer-template.toml', 'utf8'));
      var operator = bootstrapConfigFile.ethereum.account.Address;

      console.log("Using pre-configured bootstrap peer account " + operator);
      console.log('Checking if bootstrap peer account is already staked:');

      /*
      Since the bootstrap peer operator account doesn't change we have to
      take special consideration during pod restarts when there's no contract
      migration.  If we have such a scenario we should exit the InitContainer
      run before trying to stake the bootstrap peer operator account.  If
      we don't, the staking operation will fail causing the InitContainer
      to fail, throwing the pod into a crash loop.
      */
      let staked = await isStaked(operator);

      if (staked === true) {
        console.log('Already Staked, exiting InitContainer run!');
        return;
      } else {
        console.log('Not staked, continuing!');
      }
    // We need to unlock the operator account only in bootstrap case since it's hosted on ETH node.
    await unlockEthAccount(operator, process.env.KEEP_CLIENT_ETH_ACCOUNT_PASSWORD);
    } else {
      console.log('###########  Provisioning keep-client Standard Peer! ###########')
      console.log('\n<<<<<<<<<<<< Setting Up Operator Account ' + '>>>>>>>>>>>>');

      let operatorEthAccountPassword = process.env.KEEP_CLIENT_ETH_ACCOUNT_PASSWORD;
      let operatorAccount = await createEthAccount('operator');
      var operator = operatorAccount['address'];

      await createEthAccountKeyfile(operatorAccount['privateKey'], operatorEthAccountPassword);

      // We wallet add to make the local account available to web3 functions in the script.
      await web3.eth.accounts.wallet.add(operatorAccount['privateKey']);
    }
    // Eth account that contracts are migrated against.
    let contractOwner = process.env.CONTRACT_OWNER_ETH_ACCOUNT_ADDRESS;
    console.log('\n<<<<<<<<<<<< Unlocking Contract Owner Account ' + contractOwner + ' >>>>>>>>>>>>');
    //Transactions during staking are sent from contractOwner, must be unlocked before start.
    await unlockEthAccount(contractOwner, process.env.KEEP_CLIENT_ETH_ACCOUNT_PASSWORD);

    console.log('\n<<<<<<<<<<<< Staking Operator Account ' + operator + ' >>>>>>>>>>>>');
    await stakeOperatorAccount(operator, contractOwner);

    console.log('\n<<<<<<<<<<<< Creating keep-client Config File >>>>>>>>>>>>');
    await createKeepClientConfig(operator);

    console.log("\n########### keep-client Provisioning Complete! ###########");
  }
  catch(error) {
    console.error(error.message);
    throw error;
  }
};

async function isStaked(operator) {
  let stakedAmount = await stakingProxyContract.methods.balanceOf(operator).call();
  return stakedAmount != 0;
}

async function stakeOperatorAccount(operator, contractOwner) {

  let magpie = process.env.CONTRACT_OWNER_ETH_ACCOUNT_ADDRESS;
  let contractOwnerSigned = await web3.eth.sign(web3.utils.soliditySha3(contractOwner), operator);

  /*
  This is really a bit stupid.  The return from web3.eth.sign is different depending on whether or not
  the signer is a local or remote ETH account.  We use web3.eth.sign to set contractOwnerSigned. Here
  the bootstrap peer account already exists and is hosted on an ETH node.
  */
  if (process.env.KEEP_CLIENT_TYPE === 'bootstrap') {
    var contractOwnerSignature = contractOwnerSigned;
  } else {
    var contractOwnerSignature = contractOwnerSigned.signature;
  }

  let signature = Buffer.from(contractOwnerSignature.substr(2), 'hex');
  let delegation = '0x' + Buffer.concat([Buffer.from(magpie.substr(2), 'hex'), signature]).toString('hex');

  console.log('Checking if stakingProxy/tokenStaking Contracts Are Authorized.');

  if (!await stakingProxyContract.methods.isAuthorized(tokenStakingContract.address).call())
  {
    console.log('Authorizing stakingProxy/tokenStaking Contracts.')
    await stakingProxyContract.methods.authorizeContract(tokenStakingContract.address).send({from: contractOwner});
  }
  console.log('stakingProxy/tokenStaking Contracts Authorized!');
  console.log('Staking 1000000 KEEP tokens on operator account ' + operator);

  await keepTokenContract.methods.approveAndCall(
    tokenStakingContract.address,
    formatAmount(1000000, 18),
    delegation).send({from: contractOwner})

  console.log('Account ' + operator + ' staked!');
};

async function createEthAccount(accountName) {

  let ethAccount = await web3.eth.accounts.create();

  // We write to a file for later passage to the keep-client container
  fs.writeFile('/mnt/keep-client/config/eth_account_address', ethAccount['address'], (error) => {
    if (error) throw error;
  });
  console.log(accountName + ' Account '  + ethAccount['address'] + ' Created!');

  return ethAccount;
};

// We are creating a local account.  We must manually generate a keyfile for use by the keep-client
async function createEthAccountKeyfile(ethAccountPrivateKey, ethAccountPassword) {

  let ethAccountKeyfile = await web3.eth.accounts.encrypt(ethAccountPrivateKey, ethAccountPassword);

  // We write to a file for later passage to the keep-client container
  fs.writeFile('/mnt/keep-client/config/eth_account_keyfile', JSON.stringify(ethAccountKeyfile), (error) => {
    if (error) throw error;
  });
  console.log('Keyfile generated!');
};

async function unlockEthAccount(ethAccount, ethAccountPassword) {

  await web3.eth.personal.unlockAccount(ethAccount, ethAccountPassword, 150000);

  console.log('Account ' + ethAccount + ' unlocked!');
};

async function createKeepClientConfig(operator) {

  if (process.env.KEEP_CLIENT_TYPE === 'bootstrap' ) {
    fs.createReadStream('/tmp/keep-client-bootstrap-peer-template.toml', 'utf8').pipe(concat(function(data) {
      let parsedConfigFile = toml.parse(data);

      parsedConfigFile.ethereum.URL = ethHost.replace('http://', 'ws://') + ':' + ethWsPort;
      parsedConfigFile.ethereum.URLRPC = ethHost + ':' + ethRpcPort;
      parsedConfigFile.ethereum.ContractAddresses.KeepRandomBeacon = keepRandomBeaconContractAddress;
      parsedConfigFile.ethereum.ContractAddresses.KeepGroup = keepGroupContractAddress;
      parsedConfigFile.ethereum.ContractAddresses.Staking = stakingProxyContractAddress;
      parsedConfigFile.LibP2P.Seed = 2;
      parsedConfigFile.LibP2P.Port = 3919;

      /*
      tomlify.toToml() writes our Seed/Port values as a float.  The added precision renders our config
      file unreadable by the keep-client as it interprets 3919.0 as a string when it expects an int.
      Here we format the default rendering to write the config file with Seed/Port values as needed.
      */
      let formattedConfigFile = tomlify.toToml(parsedConfigFile, {
        replace: (key, value) => { return (key == 'Seed' || key == 'Port') ? value.toFixed(0) : false }
      });

      fs.writeFile('/mnt/keep-client/config/keep-client-config.toml', formattedConfigFile, (error) => {
        if (error) throw error;
      });
    }));
  } else {
    fs.createReadStream('/tmp/keep-client-standard-peer-template.toml', 'utf8').pipe(concat(function(data) {
      let parsedConfigFile = toml.parse(data);

      parsedConfigFile.ethereum.URL = ethHost.replace('http://', 'ws://') + ':' + ethWsPort;
      parsedConfigFile.ethereum.URLRPC = ethHost + ':' + ethRpcPort;
      parsedConfigFile.ethereum.account.Address = operator;
      parsedConfigFile.ethereum.account.KeyFile = '/mnt/keep-client/config/eth_account_keyfile';
      parsedConfigFile.ethereum.ContractAddresses.KeepRandomBeacon = keepRandomBeaconContractAddress;
      parsedConfigFile.ethereum.ContractAddresses.KeepGroup = keepGroupContractAddress;
      parsedConfigFile.ethereum.ContractAddresses.Staking = stakingProxyContractAddress;
      parsedConfigFile.LibP2P.Port = 3919;

      let formattedConfigFile = tomlify.toToml(parsedConfigFile, {
        replace: (key, value) => { return key == 'Port' ? value.toFixed(0) : false }
      });

      fs.writeFile('/mnt/keep-client/config/keep-client-config.toml', formattedConfigFile, (error) => {
        if (error) throw error;
      });
    }));
  }
  console.log("keep-client config written to /mnt/keep-client/config/keep-client-config.toml");
};

/*
\heimdall aliens numbers.  Really though, the approveAndCall function expects numbers
in a particular format, this function facilitates that.
*/
function formatAmount(amount, decimals) {
  return '0x' + web3.utils.toBN(amount).mul(web3.utils.toBN(10).pow(web3.utils.toBN(decimals))).toString('hex');
};

provisionKeepClient().catch(error => {
  console.error(error);
  process.exit(1);
});

