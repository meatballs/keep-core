const {
  expectRevert,
  expectEvent,
  constants,
  time,
} = require("@openzeppelin/test-helpers")

const {
  accounts,
  privateKeys,
  contract,
  web3,
} = require("@openzeppelin/test-environment")

const { createSnapshot, restoreSnapshot } = require("../helpers/snapshot.js")
const { parseBalanceMap } = require("@keep-network/merkle-distributor-helper")

const TokenDistributor = contract.fromArtifact("TokenDistributor")
const TestToken = contract.fromArtifact("TestToken")

const { ZERO_ADDRESS } = constants

const { BN, toBN } = web3.utils
const chai = require("chai")
chai.use(require("bn-chai")(BN))
const { expect } = chai

describe("TokenDistributor", () => {
  const ownerIndex = 1
  const recipientIndex = 2
  const destinationIndex = 3
  const thirdPartyIndex = 4

  const owner = accounts[ownerIndex]
  const recipient = accounts[recipientIndex]
  const destination = accounts[destinationIndex]
  const thirdParty = accounts[thirdPartyIndex]

  const unclaimedUnlockDuration = time.duration.weeks(12)

  const allocationsMap = {}
  allocationsMap[thirdParty] = (27600092).toString(16)
  allocationsMap[recipient] = (15800037).toString(16)

  const testData = {
    signature: web3.eth.accounts.sign(
      web3.utils.sha3(destination),
      privateKeys[recipientIndex]
    ),
    merkle: parseBalanceMap(allocationsMap),
  }

  let testToken
  let tokenDistributor

  const freshDeployment = async () => {
    testToken = await TestToken.new({ from: owner })
    tokenDistributor = await TokenDistributor.new(testToken.address, {
      from: owner,
    })

    await testToken.mint(owner, testData.merkle.tokenTotal)
    await testToken.approve(
      tokenDistributor.address,
      testData.merkle.tokenTotal,
      {
        from: owner,
      }
    )
  }

  before(freshDeployment)

  beforeEach(async () => {
    await createSnapshot()
  })

  afterEach(async () => {
    await restoreSnapshot()
  })

  describe("allocate", async () => {
    it("transfers tokens", async function () {
      await tokenDistributor.allocate(
        testData.merkle.merkleRoot,
        testData.merkle.tokenTotal,
        unclaimedUnlockDuration,
        { from: owner }
      )

      expect(
        await testToken.balanceOf(tokenDistributor.address),
        "invalid token distributor balance"
      ).to.eq.BN(toBN(testData.merkle.tokenTotal))
    })

    it("sets merkle root", async function () {
      await tokenDistributor.allocate(
        testData.merkle.merkleRoot,
        testData.merkle.tokenTotal,
        unclaimedUnlockDuration,
        { from: owner }
      )

      expect(await tokenDistributor.merkleRoot()).to.equal(
        testData.merkle.merkleRoot
      )
    })

    it("emits event", async function () {
      expectEvent(
        await tokenDistributor.allocate(
          testData.merkle.merkleRoot,
          testData.merkle.tokenTotal,
          unclaimedUnlockDuration,
          { from: owner }
        ),
        "TokensAllocated",
        {
          merkleRoot: testData.merkle.merkleRoot,
          amount: toBN(testData.merkle.tokenTotal),
        }
      )
    })

    it("sets unclaimed tokens unlock timestamp", async function () {
      const { receipt } = await tokenDistributor.allocate(
        testData.merkle.merkleRoot,
        testData.merkle.tokenTotal,
        unclaimedUnlockDuration,
        { from: owner }
      )

      const timestamp = toBN(
        (await web3.eth.getBlock(receipt.blockNumber)).timestamp
      )

      expect(
        await tokenDistributor.unclaimedUnlockTimestamp(),
        "invalid unclaimed unlock timestamp"
      ).to.eq.BN(timestamp.add(unclaimedUnlockDuration))
    })

    it("doesn't set unclaimed tokens unlock timestamp when unclaimed duration is not provided", async function () {
      await tokenDistributor.allocate(
        testData.merkle.merkleRoot,
        testData.merkle.tokenTotal,
        0,
        { from: owner }
      )

      expect(
        await tokenDistributor.unclaimedUnlockTimestamp(),
        "invalid unclaimed unlock timestamp"
      ).to.eq.BN(0)
    })

    it("reverts on merkle root overwrite", async function () {
      await tokenDistributor.allocate(
        testData.merkle.merkleRoot,
        testData.merkle.tokenTotal,
        unclaimedUnlockDuration,
        { from: owner }
      )

      await expectRevert(
        tokenDistributor.allocate(
          "0x1234567890",
          testData.merkle.tokenTotal,
          unclaimedUnlockDuration,
          {
            from: owner,
          }
        ),
        "tokens were already allocated"
      )
    })

    it("reverts on empty merkle root", async function () {
      await expectRevert(
        tokenDistributor.allocate(
          [],
          testData.merkle.tokenTotal,
          unclaimedUnlockDuration,
          {
            from: owner,
          }
        ),
        "merkle root cannot be empty"
      )
    })

    it("reverts on token transfer failure", async function () {
      await expectRevert(
        tokenDistributor.allocate(
          testData.merkle.merkleRoot,
          testData.merkle.tokenTotal + 1,
          unclaimedUnlockDuration,
          {
            from: owner,
          }
        ),
        "SafeERC20: low-level call failed"
      )
    })

    it("reverts when called by non-owner", async function () {
      await expectRevert(
        tokenDistributor.allocate(
          testData.merkle.merkleRoot,
          testData.merkle.tokenTotal,
          unclaimedUnlockDuration,
          {
            from: thirdParty,
          }
        ),
        "Ownable: caller is not the owner"
      )
    })
  })

  describe("claim", async () => {
    before(async () => {
      await tokenDistributor.allocate(
        testData.merkle.merkleRoot,
        testData.merkle.tokenTotal,
        unclaimedUnlockDuration,
        { from: owner }
      )
    })

    after(freshDeployment)

    it("transfers tokens", async function () {
      const recipientInitialBalance = toBN(await testToken.balanceOf(recipient))
      const destinationInitialBalance = toBN(
        await testToken.balanceOf(destination)
      )

      await tokenDistributor.claim(
        recipient,
        destination,
        testData.signature.v,
        testData.signature.r,
        testData.signature.s,
        testData.merkle.claims[recipient].index,
        testData.merkle.claims[recipient].amount,
        testData.merkle.claims[recipient].proof
      )

      expect(
        await testToken.balanceOf(recipient),
        "invalid recipient address balance"
      ).to.eq.BN(toBN(recipientInitialBalance))

      expect(
        await testToken.balanceOf(destination),
        "invalid destination address balance"
      ).to.eq.BN(
        destinationInitialBalance.add(
          toBN(testData.merkle.claims[recipient].amount)
        )
      )
    })

    it("emits event", async function () {
      expectEvent(
        await tokenDistributor.claim(
          recipient,
          destination,
          testData.signature.v,
          testData.signature.r,
          testData.signature.s,
          testData.merkle.claims[recipient].index,
          testData.merkle.claims[recipient].amount,
          testData.merkle.claims[recipient].proof
        ),
        "TokensClaimed",
        {
          index: testData.merkle.claims[recipient].index.toString(),
          recipient: recipient,
          destination: destination,
          amount: toBN(testData.merkle.claims[recipient].amount),
        }
      )
    })

    it("destination address signature verification", async function () {
      const testCases = new Map([
        [
          "completes when signed by recipient, submitted by third-party",
          {
            signer: recipientIndex,
            submitter: thirdPartyIndex,
            expectRevert: false,
          },
        ],
        [
          "completes when signed by recipient, submitted by recipient",
          {
            signer: recipientIndex,
            submitter: recipientIndex,
            expectRevert: false,
          },
        ],
        [
          "reverts when signed by third-party, submitted by recipient",
          {
            signer: thirdPartyIndex,
            submitter: recipientIndex,
            expectRevert: true,
          },
        ],
        [
          "completes when signed by recipient, submitted by destination",
          {
            signer: recipientIndex,
            submitter: destinationIndex,
            expectRevert: false,
          },
        ],
        [
          "reverts when signed by destination, submitted by recipient",
          {
            signer: destinationIndex,
            submitter: recipientIndex,
            expectRevert: true,
          },
        ],
        [
          "reverts when signed by destination, submitted by destination",
          {
            signer: destinationIndex,
            submitter: destinationIndex,
            expectRevert: true,
          },
        ],
      ])

      for (const [testCaseName, testCaseData] of testCases) {
        await createSnapshot()

        console.log(`      ${testCaseName}`)
        try {
          const signature = web3.eth.accounts.sign(
            web3.utils.sha3(destination),
            privateKeys[testCaseData.signer]
          )

          claimFuncCall = tokenDistributor.claim(
            recipient,
            destination,
            signature.v,
            signature.r,
            signature.s,
            testData.merkle.claims[recipient].index,
            testData.merkle.claims[recipient].amount,
            testData.merkle.claims[recipient].proof,
            { from: accounts[testCaseData.submitter] }
          )

          if (testCaseData.expectRevert) {
            await expectRevert(claimFuncCall, "invalid signature")
          } else {
            await claimFuncCall
          }
        } catch (err) {
          throw new Error(
            `Test case [${testCaseName}] failed with error: ${err}`
          )
        } finally {
          await restoreSnapshot()
        }
      }
    })

    it("reverts on malleable signatures", async function () {
      const secp256k1N = toBN(
        "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141"
      )

      const malleableS =
        "0x" + secp256k1N.sub(toBN(testData.signature.s)).toJSON()

      await expectRevert(
        tokenDistributor.claim(
          recipient,
          destination,
          testData.signature.v,
          testData.signature.r,
          malleableS,
          testData.merkle.claims[recipient].index,
          testData.merkle.claims[recipient].amount,
          testData.merkle.claims[recipient].proof
        ),
        "Invalid signature 's' value"
      )

      await expectRevert(
        tokenDistributor.claim(
          recipient,
          destination,
          testData.signature.v - 27,
          testData.signature.r,
          testData.signature.s,
          testData.merkle.claims[recipient].index,
          testData.merkle.claims[recipient].amount,
          testData.merkle.claims[recipient].proof
        ),
        "Invalid signature 'v' value"
      )
    })

    it("reverts on empty addresses", async function () {
      await expectRevert(
        tokenDistributor.claim(
          ZERO_ADDRESS,
          destination,
          testData.signature.v,
          testData.signature.r,
          testData.signature.s,
          testData.merkle.claims[recipient].index,
          testData.merkle.claims[recipient].amount,
          testData.merkle.claims[recipient].proof
        ),
        "recipient address cannot be zero"
      )

      await expectRevert(
        tokenDistributor.claim(
          recipient,
          ZERO_ADDRESS,
          testData.signature.v,
          testData.signature.r,
          testData.signature.s,
          testData.merkle.claims[recipient].index,
          testData.merkle.claims[recipient].amount,
          testData.merkle.claims[recipient].proof
        ),
        "destination address cannot be zero"
      )
    })

    it("reverts if tokens were not allocated", async function () {
      const tokenDistributor = await TokenDistributor.new(testToken.address, {
        from: owner,
      })

      await expectRevert(
        tokenDistributor.claim(
          recipient,
          destination,
          testData.signature.v,
          testData.signature.r,
          testData.signature.s,
          testData.merkle.claims[recipient].index,
          testData.merkle.claims[recipient].amount,
          testData.merkle.claims[recipient].proof
        ),
        "tokens were not allocated yet"
      )
    })

    it("reverts if tokens were already claimed", async function () {
      await tokenDistributor.claim(
        recipient,
        destination,
        testData.signature.v,
        testData.signature.r,
        testData.signature.s,
        testData.merkle.claims[recipient].index,
        testData.merkle.claims[recipient].amount,
        testData.merkle.claims[recipient].proof
      )

      await expectRevert(
        tokenDistributor.claim(
          recipient,
          destination,
          testData.signature.v,
          testData.signature.r,
          testData.signature.s,
          testData.merkle.claims[recipient].index,
          testData.merkle.claims[recipient].amount,
          testData.merkle.claims[recipient].proof
        ),
        "tokens already claimed"
      )
    })
  })

  describe("recoverUnclaimed", async function () {
    const allocate = async (unlockDuration) => {
      const { receipt } = await tokenDistributor.allocate(
        testData.merkle.merkleRoot,
        testData.merkle.tokenTotal,
        unlockDuration,
        { from: owner }
      )

      return toBN((await web3.eth.getBlock(receipt.blockNumber)).timestamp)
    }

    it("transfers tokens to destination address", async function () {
      const timestamp = await allocate(unclaimedUnlockDuration)
      await time.increaseTo(timestamp.add(unclaimedUnlockDuration))

      const destinationInitialBalance = toBN(
        await testToken.balanceOf(destination)
      )

      await tokenDistributor.recoverUnclaimed(destination, { from: owner })

      expect(
        await testToken.balanceOf(destination),
        "invalid recipient address balance"
      ).to.eq.BN(
        toBN(destinationInitialBalance.add(toBN(testData.merkle.tokenTotal)))
      )
    })

    it("emits event", async function () {
      const timestamp = await allocate(unclaimedUnlockDuration)
      await time.increaseTo(timestamp.add(unclaimedUnlockDuration))

      expectEvent(
        await tokenDistributor.recoverUnclaimed(destination, { from: owner }),
        "TokensRecovered",
        {
          destination: destination,
          amount: toBN(testData.merkle.tokenTotal),
        }
      )
    })

    it("reverts on empty destination addresse", async function () {
      await expectRevert(
        tokenDistributor.recoverUnclaimed(ZERO_ADDRESS, { from: owner }),
        "destination address cannot be zero"
      )
    })

    it("reverts if tokens recovery is not allowed", async function () {
      await allocate(0)

      await expectRevert(
        tokenDistributor.recoverUnclaimed(destination, { from: owner }),
        "token recovery is not allowed"
      )
    })

    it("reverts if unlock period has not passed yet", async function () {
      const timestamp = await allocate(unclaimedUnlockDuration)

      await time.increaseTo(timestamp.add(unclaimedUnlockDuration).subn(1))

      await expectRevert(
        tokenDistributor.recoverUnclaimed(destination, { from: owner }),
        "token recovery is not possible yet"
      )
    })

    it("reverts when called by non-owner", async function () {
      await expectRevert(
        tokenDistributor.recoverUnclaimed(destination, {
          from: thirdParty,
        }),
        "Ownable: caller is not the owner"
      )
    })
  })
})
