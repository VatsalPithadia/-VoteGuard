import { ethers } from "hardhat";

function id(value: string) {
  return ethers.keccak256(ethers.toUtf8Bytes(value));
}

async function main() {
  const [admin, voter] = await ethers.getSigners();

  const Factory = await ethers.getContractFactory("VoteGuardNational");
  const c = await Factory.deploy(admin.address);
  await c.waitForDeployment();

  const state = "Gujarat";
  const constituency = "Ahmedabad East";

  const stateId = id(state);
  const constituencyId = id(constituency);
  const regionKey = await c.regionKey(stateId, constituencyId);

  console.log("Contract:", await c.getAddress());
  console.log("Admin:", admin.address);
  console.log("State:", state, stateId);
  console.log("Constituency:", constituency, constituencyId);
  console.log("RegionKey:", regionKey);

  await (await c.createConstituency(stateId, constituencyId)).wait();
  await (await c.addCandidate(stateId, constituencyId, "Alice", "Party A")).wait();
  await (await c.addCandidate(stateId, constituencyId, "Bob", "Party B")).wait();
  await (await c.openVoting(stateId, constituencyId)).wait();

  await (await c.setVerifiedVoter(voter.address, true)).wait();
  await (await c.connect(voter).vote(stateId, constituencyId, 0)).wait();

  const cand0 = await c.getCandidate(stateId, constituencyId, 0);
  console.log("Alice votes:", cand0.voteCount.toString());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

