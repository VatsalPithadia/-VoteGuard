// Usage: npx hardhat run scripts/verify-voter.ts --network amoy
// Edit VOTER_ADDRESS and CONTRACT_ADDRESS before running

import { ethers } from "hardhat";

const CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const VOTER_ADDRESS    = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

async function main() {
  const [admin] = await ethers.getSigners();
  console.log("Admin:", admin.address);

  const contract = await ethers.getContractAt("VoteGuardNational", CONTRACT_ADDRESS);

  const tx = await contract.setVerifiedVoter(VOTER_ADDRESS, true);
  await tx.wait();

  const verified = await contract.isVerifiedVoter(VOTER_ADDRESS);
  console.log(`✅ ${VOTER_ADDRESS} verified: ${verified}`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
