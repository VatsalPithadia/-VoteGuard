import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("🚀 Deploying with:", deployer.address);
  console.log("💰 Balance:", ethers.formatEther(balance), "POL");

  // ── 1. Deploy contract only ──────────────────────────────
  const Factory = await ethers.getContractFactory("VoteGuardNational");
  const contract = await Factory.deploy(deployer.address);
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();
  console.log("\n✅ Contract deployed at:", contractAddress);

  // ── 2. Seed ONE constituency with TWO candidates only ────
  // (keeps gas cost minimal — you can add more later)
  const stateId = ethers.keccak256(ethers.toUtf8Bytes("Delhi"));
  const constId = ethers.keccak256(ethers.toUtf8Bytes("New Delhi"));

  await (await contract.createConstituency(stateId, constId)).wait();
  console.log("✔ Created: Delhi / New Delhi");

  await (await contract.addCandidate(stateId, constId, "Bansuri Swaraj", "BJP")).wait();
  console.log("  + Candidate: Bansuri Swaraj (BJP)");

  await (await contract.addCandidate(stateId, constId, "Somnath Bharti", "AAP")).wait();
  console.log("  + Candidate: Somnath Bharti (AAP)");

  await (await contract.openVoting(stateId, constId)).wait();
  console.log("  🗳️  Voting OPEN for: New Delhi");

  // ── 3. Save deployment info + ABI for frontend ──────────
  const output = {
    contractAddress,
    network: "Polygon Amoy Testnet",
    chainId: 80002,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
  };

  const outPath = path.join(__dirname, "../FRONTED/deployment.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log("\n📄 Saved to FRONTED/deployment.json");

  const artifactPath = path.join(__dirname, "../artifacts/contracts/VoteGuardNational.sol/VoteGuardNational.json");
  if (fs.existsSync(artifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    fs.writeFileSync(path.join(__dirname, "../FRONTED/VoteGuardNational.abi.json"), JSON.stringify(artifact.abi, null, 2));
    console.log("📄 ABI saved to FRONTED/VoteGuardNational.abi.json");
  }

  console.log("\n🎉 Done!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Contract Address:", contractAddress);
  console.log("Polygonscan:", `https://amoy.polygonscan.com/address/${contractAddress}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
