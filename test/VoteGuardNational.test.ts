import { expect } from "chai";
import { ethers } from "hardhat";
import "@nomicfoundation/hardhat-chai-matchers";

describe("VoteGuardNational", () => {
  function id(value: string) {
    return ethers.keccak256(ethers.toUtf8Bytes(value));
  }

  it("enforces verified-only and one-vote-per-constituency", async () => {
    const [admin, voter1, voter2] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("VoteGuardNational");
    const c = await Factory.deploy(admin.address);
    await c.waitForDeployment();

    const stateId = id("Gujarat");
    const constituencyId = id("Ahmedabad East");

    await (await c.createConstituency(stateId, constituencyId)).wait();
    await (await c.addCandidate(stateId, constituencyId, "Alice", "Party A")).wait();
    await (await c.addCandidate(stateId, constituencyId, "Bob", "Party B")).wait();
    await (await c.openVoting(stateId, constituencyId)).wait();

    // Not verified -> cannot vote
    await expect(c.connect(voter1).vote(stateId, constituencyId, 0)).to.be.revertedWithCustomError(
      c,
      "NotVerified",
    );

    // Verify voter1 and vote
    await (await c.setVerifiedVoter(voter1.address, true)).wait();
    await (await c.connect(voter1).vote(stateId, constituencyId, 0)).wait();

    const cand0 = await c.getCandidate(stateId, constituencyId, 0);
    expect(cand0.voteCount).to.equal(1n);

    // Second vote by same voter -> blocked
    await expect(c.connect(voter1).vote(stateId, constituencyId, 1)).to.be.revertedWithCustomError(
      c,
      "AlreadyVoted",
    );

    // Another verified voter can vote
    await (await c.setVerifiedVoter(voter2.address, true)).wait();
    await (await c.connect(voter2).vote(stateId, constituencyId, 1)).wait();

    const cand1 = await c.getCandidate(stateId, constituencyId, 1);
    expect(cand1.voteCount).to.equal(1n);
  });
});

