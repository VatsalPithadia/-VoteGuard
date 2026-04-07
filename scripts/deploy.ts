import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ── Seed data (edit before deploying) ──────────────────
const SEED = [
  {
    state: "Gujarat",
    constituencies: [
      {
        name: "Ahmedabad East",
        candidates: [
          { name: "Amit Shah",        party: "BJP" },
          { name: "Shaktisinh Gohil", party: "INC" },
          { name: "Pravin Gheewala",  party: "AAP" },
        ],
      },
      {
        name: "Surat",
        candidates: [
          { name: "Mukesh Dalal",    party: "BJP" },
          { name: "Nilesh Kumbhani", party: "INC" },
        ],
      },
    ],
  },
  {
    state: "Maharashtra",
    constituencies: [
      {
        name: "Mumbai North",
        candidates: [
          { name: "Piyush Goyal",   party: "BJP" },
          { name: "Bhushan Patil",  party: "INC" },
        ],
      },
    ],
  },
  {
    state: "Rajasthan",
    constituencies: [
      {
        name: "Jaipur Rural",
        candidates: [
          { name: "Rajyavardhan Rathore", party: "BJP" },
          { name: "Anil Chopra",          party: "INC" },
        ],
      },
    ],
  },
  {
    state: "Delhi",
    constituencies: [
      {
        name: "New Delhi",
        candidates: [
          { name: "Bansuri Swaraj", party: "BJP" },
          { name: "Somnath Bharti", party: "AAP" },
          { name: "Ajay Maken",     party: "INC" },
        ],
      },
    ],
  },
];

// ── Helper to compute regionKey (same logic as Solidity) ─
function regionKey(stateId: string, constId: string): string {
  return ethers.solidityPackedKeccak256(
    ["bytes32", "bytes32"],
    [stateId, constId]
  );
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("🚀 Deploying with:", deployer.address);
  console.log(
    "💰 Balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "MATIC"
  );

  // ── 1. Deploy ───────────────────────────────────────────
  const Factory = await ethers.getContractFactory("VoteGuardNational");
  const contract = await Factory.deploy(deployer.address);
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();
  console.log("\n✅ VoteGuardNational deployed at:", contractAddress);

  // ── 2. Seed constituencies + candidates ─────────────────
  console.log("\n📋 Seeding constituencies and candidates...");

  const deploymentData: Record<string, Record<string, { regionKey: string; candidateCount: number }>> = {};

  for (const stateData of SEED) {
    const stateId = ethers.keccak256(ethers.toUtf8Bytes(stateData.state));
    deploymentData[stateData.state] = {};

    for (const constData of stateData.constituencies) {
      const constId = ethers.keccak256(ethers.toUtf8Bytes(constData.name));
      const rKey = regionKey(stateId, constId);

      // Create constituency
      const createTx = await contract.createConstituency(stateId, constId);
      await createTx.wait();
      console.log(`  ✔ Created: ${stateData.state} / ${constData.name}`);

      // Add candidates
      for (const cand of constData.candidates) {
        const addTx = await contract.addCandidate(stateId, constId, cand.name, cand.party);
        await addTx.wait();
        console.log(`    + Candidate: ${cand.name} (${cand.party})`);
      }

      // Open voting
      const openTx = await contract.openVoting(stateId, constId);
      await openTx.wait();
      console.log(`  🗳️  Voting OPEN for: ${constData.name}`);

      deploymentData[stateData.state][constData.name] = {
        regionKey: rKey,
        candidateCount: constData.candidates.length,
      };
    }
  }

  // ── 3. Write deployment info for frontend ───────────────
  const output = {
    contractAddress,
    network: "Polygon Amoy Testnet",
    chainId: 80002,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    constituencies: deploymentData,
  };

  const outPath = path.join(__dirname, "../FRONTED/deployment.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log("\n📄 Deployment info saved to FRONTED/deployment.json");

  // ── 4. Copy ABI to frontend ─────────────────────────────
  const artifactPath = path.join(
    __dirname,
    "../artifacts/contracts/VoteGuardNational.sol/VoteGuardNational.json"
  );
  if (fs.existsSync(artifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    const abiPath = path.join(__dirname, "../FRONTED/VoteGuardNational.abi.json");
    fs.writeFileSync(abiPath, JSON.stringify(artifact.abi, null, 2));
    console.log("📄 ABI saved to FRONTED/VoteGuardNational.abi.json");
  }

  console.log("\n🎉 All done!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Contract Address:", contractAddress);
  console.log("Polygonscan:     ", `https://amoy.polygonscan.com/address/${contractAddress}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("\nNext step → Verify on Polygonscan:");
  console.log(`npx hardhat verify --network amoy ${contractAddress} "${deployer.address}"`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});