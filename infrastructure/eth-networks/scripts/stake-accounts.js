const fs = require('fs');
const Web3 = require('web3');
const HDWalletProvider = require("@truffle/hdwallet-provider");
const commandLineArgs = require('minimist')(process.argv.slice(2));

// ETH host info
const ethHost = 'https://ropsten.infura.io/v3/59fb36a36fa4474b890c13dd30038be5';
const ethNetworkId = '3';

// Contract owner info
const contractOwnerAddress = '0x0396457c928e58ae32bf28d7f3132d66653ccf5d';
const contractOwnerProvider = new HDWalletProvider("EBAE221D3C6A4707B1B00927CE9DD6F866DC426658842CE3CFF5EBDAC2BF6000", "https://ropsten.infura.io/v3/59fb36a36fa4474b890c13dd30038be5");

// We override transactionConfirmationBlocks and transactionBlockTimeout because they're
// 25 and 50 blocks respectively at default.  The result of this on small private testnets
// is long wait times for scripts to execute.
const web3_options = {
    defaultBlock: 'latest',
    defaultGas: 4712388,
    transactionBlockTimeout: 25,
    transactionConfirmationBlocks: 3,
    transactionPollingTimeout: 480
};

// We use the contractOwner for all web3 calls except those where the operator address is
// required.
const web3 = new Web3(contractOwnerProvider, null, web3_options);

const environment = commandLineArgs.e

if (environment == 'keep-dev') {

  var operatorAddresses = [
    '0x7fb43a257bf74904a41506fe38c87d32d91a77ae',
    '0xb6eb060a8d82a0bec265298aaccbf3577c2a5825',
    '0x4050aa55ae9bd11b7ea42d44dab3a6a1874dd751',
    '0x186ab1ed890e341c9c882ba20459fd4f6ef18a30',
    '0x75353501e93ca9c9f48cb8ae82a7a218f1483267'
  ]

} else if (environment == 'keep-test') {

  var operatorAddresses = [
    '0x58dd09096d27026a1a574cfc1dde10c07f7a9636',
    '0xeea0a80cb35ed34093e90559f50188d18e41b574',
    '0x95aeea994a0dec98228f99479c3e532234ab1406',
    '0xfd326104974e2fb01c02becd634fac5bff23d33f',
    '0x35173638d6fe801de9b08916583ac16bdc987bc5',
    '0xaa886f33bfe5cf672effcfdf9c630bdb785802f8',
    '0x6ea036cb7a72c89d46cee43214a7c5fd969e8f59',
    '0xdbcd9a619b4d48ba67059a78734bb3b7ee6ece57',
    '0xc66c2e2100279b444e7ff596e5ca900c3a9b65e4',
    '0xcc90f3910b325f6a984ee953d62252993dbb0b8b'
  ]

} else {
    console.log('Invalid options passed.  Please use -e keep-dev or -e keep-test');
    process.exit(1);
};

// Each <contract.json> file is sourced directly from the InitContainer.  Files are generated by
// Truffle during contract and copied to the InitContainer image via Circle.
// TokenStaking
const tokenStakingContractJsonFile = `../${environment}/ropsten/TokenStaking.json`;
const tokenStakingContractParsed = JSON.parse(fs.readFileSync(tokenStakingContractJsonFile));
const tokenStakingContractAbi = tokenStakingContractParsed.abi;
const tokenStakingContractAddress = tokenStakingContractParsed.networks[ethNetworkId].address;
const tokenStakingContract = new web3.eth.Contract(tokenStakingContractAbi, tokenStakingContractAddress);

// KeepToken
const keepTokenContractJsonFile = `../${environment}/ropsten/KeepToken.json`;
const keepTokenContractParsed = JSON.parse(fs.readFileSync(keepTokenContractJsonFile));
const keepTokenContractAbi = keepTokenContractParsed.abi;
const keepTokenContractAddress = keepTokenContractParsed.networks[ethNetworkId].address;
const keepTokenContract = new web3.eth.Contract(keepTokenContractAbi, keepTokenContractAddress);

// KeepRandomBeaconOperator
const keepRandomBeaconOperatorContractJsonFile = `../${environment}/ropsten/KeepRandomBeaconOperator.json`;
const keepRandomBeaconOperatorContractParsed = JSON.parse(fs.readFileSync(keepRandomBeaconOperatorContractJsonFile));
const keepRandomBeaconOperatorContractAddress = keepRandomBeaconOperatorContractParsed.networks[ethNetworkId].address;

async function stakeOperatorAccount(operatorAddress, contractOwnerAddress) {

  let delegation = '0x' + Buffer.concat([
    Buffer.from(contractOwnerAddress.substr(2), 'hex'),
    Buffer.from(operatorAddress.substr(2), 'hex'),
    Buffer.from(contractOwnerAddress.substr(2), 'hex') // authorizer
  ]).toString('hex');;

  console.log(`Staking 2000000 KEEP tokens on operator account ${operatorAddress}`);

  await keepTokenContract.methods.approveAndCall(
    tokenStakingContract.address,
    formatAmount(20000000, 18),
    delegation).send({from: contractOwnerAddress});

  await tokenStakingContract.authorizeOperatorContract(operatorAddress, keepRandomBeaconOperatorContractAddress, {from: contractOwnerAddress});

  console.log(`Account ${operatorAddress} staked!`);
};

function formatAmount(amount, decimals) {
  return '0x' + web3.utils.toBN(amount).mul(web3.utils.toBN(10).pow(web3.utils.toBN(decimals))).toString('hex');
};

operatorAddresses.forEach(operatorAddress => {
  stakeOperatorAccount(operatorAddress, contractOwnerAddress).catch(error => {
    console.error(error);
    process.exit(1);
  })
});