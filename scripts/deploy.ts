import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  const Factory = await ethers.getContractFactory("VoteGuardNational");
  const contract = await Factory.deploy(deployer.address);
  await contract.waitForDeployment();

  console.log("Deployer:", deployer.address);
  console.log("VoteGuardNational:", await contract.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

