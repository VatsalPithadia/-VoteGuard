// ═══════════════════════════════════════════════════════════════
//  VoteGuard — VOTE.JS
//  Part 3 + Part 4: Smart Contract Integration (ethers.js v6)
//                   Auth0 Token Vault + Blockchain Bridge
// ═══════════════════════════════════════════════════════════════

// ── 0. CONFIG — fill these after deploying ───────────────────
const CONFIG = {
  CONTRACT_ADDRESS: "0x5FbDB2315678afecb367f032d93F642f64180aa3",

  // Auth0 settings (from your Auth0 dashboard)
  AUTH0_DOMAIN:    "dev-6top2zdnrx34p5m3.us.auth0.com",
  AUTH0_CLIENT_ID: "FUjVMMGtaPb1juxQed7YXVKoTB9KToBD",

  // Local Hardhat Network
  CHAIN_ID:   31337,
  CHAIN_NAME: "Hardhat Local",
  RPC_URL:    "http://192.168.1.3:8545",
  EXPLORER:   "http://127.0.0.1:8545",

  CONSTITUENCIES: {
    "Delhi": ["New Delhi"],
  },
};

// ── 1. ABI (only the functions we need in the frontend) ──────
const ABI = [
  // Read
  "function idFromString(string calldata value) public pure returns (bytes32)",
  "function regionKey(bytes32 stateId, bytes32 constituencyId) public pure returns (bytes32)",
  "function candidateCount(bytes32 regionKey) public view returns (uint256)",
  "function getCandidate(bytes32 stateId, bytes32 constituencyId, uint256 candidateId) external view returns (tuple(string name, string party, uint256 voteCount, bool active))",
  "function hasVoted(bytes32 regionKey, address voter) public view returns (bool)",
  "function isVerifiedVoter(address voter) public view returns (bool)",
  "function constituencyMeta(bytes32 regionKey) public view returns (bool created, bool votingOpen, uint64 createdAt, uint64 votingOpenedAt, uint64 votingClosedAt)",
  // Write
  "function vote(bytes32 stateId, bytes32 constituencyId, uint256 candidateId) external",
  // Events
  "event VoteCast(bytes32 indexed regionKey, address indexed voter, uint256 indexed candidateId)",
];

// ── 2. State ─────────────────────────────────────────────────
let auth0Client   = null;
let provider      = null;   // ethers BrowserProvider (MetaMask)
let signer        = null;   // connected wallet
let contract      = null;   // ethers Contract instance
let currentUser   = null;   // Auth0 user profile
let selectedState = null;
let selectedConst = null;

// ═══════════════════════════════════════════════════════════════
//  PART 4-A: Auth0 Token Vault Integration
// ═══════════════════════════════════════════════════════════════

async function initAuth0() {
  await loadScript("https://cdn.auth0.com/js/auth0-spa-js/2.1/auth0-spa-js.production.js");

  auth0Client = await window.auth0.createAuth0Client({
    domain:   CONFIG.AUTH0_DOMAIN,
    clientId: CONFIG.AUTH0_CLIENT_ID,
    authorizationParams: {
      redirect_uri: "http://127.0.0.1:5500/-VoteGuard/FRONTED/VOTE.HTML",
      scope: "openid profile email offline_access",
    },
    useRefreshTokens: true,
    cacheLocation: "localstorage",
  });

  console.log("URL search:", window.location.search);

  // Handle redirect callback after Auth0 login
  if (window.location.search.includes("code=")) {
    try {
      console.log("Handling redirect callback...");
      await auth0Client.handleRedirectCallback();
      window.history.replaceState({}, document.title, window.location.pathname);
      console.log("Callback handled, calling onLoginSuccess");
      await onLoginSuccess();
      return;
    } catch (e) {
      console.error("Auth0 callback error:", e);
    }
  }

  const isAuthenticated = await auth0Client.isAuthenticated();
  console.log("isAuthenticated:", isAuthenticated);
  if (isAuthenticated) {
    await onLoginSuccess();
  }
}

async function loginWithAuth0() {
  await auth0Client.loginWithRedirect();
}

async function logoutAuth0() {
  await auth0Client.logout({ logoutParams: { returnTo: "http://127.0.0.1:5500/-VoteGuard/FRONTED/VOTE.HTML" } });
}

async function onLoginSuccess() {
  currentUser = await auth0Client.getUser();

  document.getElementById("screen-landing").classList.remove("active");
  document.getElementById("screen-main").classList.add("active");
  document.getElementById("user-chip").textContent = `👤 ${currentUser.name || currentUser.email}`;

  const accessToken = await auth0Client.getTokenSilently();
  console.log("🔐 Token Vault: access token acquired");

  await connectBlockchain();
}

// ═══════════════════════════════════════════════════════════════
//  PART 4-B: Blockchain Bridge (ethers.js v6)
// ═══════════════════════════════════════════════════════════════

async function connectBlockchain() {
  if (!window.ethereum) {
    showToast("⚠️ MetaMask not found. Please install it.", "error");
    return;
  }

  try {
    // Request wallet access
    await window.ethereum.request({ method: "eth_requestAccounts" });

    provider = new ethers.BrowserProvider(window.ethereum);
    signer   = await provider.getSigner();

    // Switch to Polygon Amoy if needed
    await ensureCorrectNetwork();

    // Connect to the smart contract
    contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, ABI, signer);

    const address = await signer.getAddress();
    console.log("✅ Wallet connected:", address);

    // Check if this wallet is verified on-chain
    const verified = await contract.isVerifiedVoter(address);
    if (!verified) {
      showToast("ℹ️ Your wallet is not yet verified on-chain. Contact the election authority.", "info");
    }

    // Listen for VoteCast events for live feed
    listenForVoteEvents();

  } catch (err) {
    console.error("Blockchain connection error:", err);
    showToast("❌ Could not connect wallet: " + err.message, "error");
  }
}

async function ensureCorrectNetwork() {
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== CONFIG.CHAIN_ID) {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x" + CONFIG.CHAIN_ID.toString(16) }],
      });
    } catch (switchErr) {
      // Chain not added — add it automatically
      if (switchErr.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId:          "0x" + CONFIG.CHAIN_ID.toString(16),
            chainName:        CONFIG.CHAIN_NAME,
            nativeCurrency:   { name: "MATIC", symbol: "MATIC", decimals: 18 },
            rpcUrls:          [CONFIG.RPC_URL],
            blockExplorerUrls:[CONFIG.EXPLORER],
          }],
        });
      } else {
        throw switchErr;
      }
    }
    // Re-init provider after network switch
    provider = new ethers.BrowserProvider(window.ethereum);
    signer   = await provider.getSigner();
  }
}

// ═══════════════════════════════════════════════════════════════
//  PART 3: Smart Contract Read/Write Functions
// ═══════════════════════════════════════════════════════════════

// Helper: convert string → bytes32 (matching Solidity's idFromString)
function toBytes32(str) {
  return ethers.keccak256(ethers.toUtf8Bytes(str));
}

async function loadCandidates(stateName, constName) {
  if (!contract) {
    showToast("⚠️ Wallet not connected yet.", "error");
    return;
  }

  const stateId = toBytes32(stateName);
  const constId = toBytes32(constName);

  try {
    const count = await contract.candidateCount(
      ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [stateId, constId])
    );

    const grid = document.getElementById("candidate-grid");
    grid.innerHTML = "";

    const voterAddress = await signer.getAddress();
    const rKey = ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [stateId, constId]);
    const alreadyVoted = await contract.hasVoted(rKey, voterAddress);

    for (let i = 0; i < Number(count); i++) {
      const cand = await contract.getCandidate(stateId, constId, i);
      grid.innerHTML += buildCandidateCard(cand, i, alreadyVoted);
    }

    // Render live vote chart
    await renderVoteChart(stateId, constId, count);

    if (alreadyVoted) {
      showToast("ℹ️ You have already voted in this constituency.", "info");
    }

  } catch (err) {
    console.error("Error loading candidates:", err);
    showToast("❌ Could not load candidates: " + err.message, "error");
  }
}

function buildCandidateCard(cand, index, alreadyVoted) {
  const partyEmojis = { BJP: "🪷", INC: "✋", AAP: "🧹", BSP: "🐘", SP: "🚲" };
  const emoji = partyEmojis[cand.party] || "🗳️";
  const disabled = !cand.active || alreadyVoted ? "disabled" : "";
  const disabledNote = !cand.active ? "⛔ Inactive" : alreadyVoted ? "✅ Voted" : "";

  return `
    <div class="candidate-card glass ${!cand.active ? "inactive" : ""}">
      <div class="cand-symbol">${emoji}</div>
      <h3>${cand.name}</h3>
      <p class="cand-party">${cand.party}</p>
      <p class="cand-votes">🗳️ ${cand.voteCount.toString()} votes on-chain</p>
      ${disabledNote ? `<p class="cand-note">${disabledNote}</p>` : ""}
      <button
        class="btn-vote btn-primary"
        onclick="castVote(${index})"
        ${disabled}
      >
        Vote
      </button>
      <button class="btn-ghost" onclick="showManifesto('${cand.name}', '${cand.party}')">
        📜 Manifesto
      </button>
    </div>
  `;
}

// ── THE VOTE TRANSACTION (Part 4 - The Bridge) ──────────────
async function castVote(candidateId) {
  if (!contract || !signer) {
    showToast("⚠️ Please connect your wallet first.", "error");
    return;
  }
  if (!selectedState || !selectedConst) {
    showToast("⚠️ Please select your region first.", "error");
    return;
  }

  const stateId = toBytes32(selectedState);
  const constId = toBytes32(selectedConst);

  // ── Token Vault Exchange: verify Auth0 session before allowing vote
  try {
    const token = await auth0Client.getTokenSilently();
    if (!token) throw new Error("Auth0 session expired");
    console.log("🔐 Token Vault: session verified before vote");
  } catch {
    showToast("❌ Auth0 session expired. Please log in again.", "error");
    return;
  }

  showToast("⏳ Sending your vote to the blockchain…", "info");

  try {
    // Send the transaction
    const tx = await contract.vote(stateId, constId, candidateId);
    showToast("⏳ Transaction submitted. Waiting for confirmation…", "info");

    const receipt = await tx.wait();

    // ── SUCCESS: Show transaction hash with confetti
    const shortHash = receipt.hash.slice(0, 10) + "…" + receipt.hash.slice(-8);
    showSuccessModal(receipt.hash, shortHash);

    // Reload candidates to show updated vote counts
    await loadCandidates(selectedState, selectedConst);

  } catch (err) {
    console.error("Vote error:", err);
    if (err.message.includes("NotVerified")) {
      showToast("❌ Your wallet is not verified as an eligible voter.", "error");
    } else if (err.message.includes("AlreadyVoted")) {
      showToast("❌ You have already cast your vote.", "error");
    } else if (err.message.includes("VotingNotOpen")) {
      showToast("❌ Voting is not open for this constituency.", "error");
    } else if (err.message.includes("user rejected")) {
      showToast("⚠️ Transaction cancelled.", "info");
    } else {
      showToast("❌ Vote failed: " + err.message, "error");
    }
  }
}

async function renderVoteChart(stateId, constId, count) {
  const chart = document.getElementById("vote-chart");
  chart.innerHTML = "";
  let total = 0;
  const data = [];

  for (let i = 0; i < Number(count); i++) {
    const cand = await contract.getCandidate(stateId, constId, i);
    const votes = Number(cand.voteCount);
    data.push({ name: cand.name, party: cand.party, votes });
    total += votes;
  }

  const colors = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];
  data.forEach((d, i) => {
    const pct = total > 0 ? ((d.votes / total) * 100).toFixed(1) : 0;
    chart.innerHTML += `
      <div class="chart-row">
        <span class="chart-label">${d.party}</span>
        <div class="chart-bar-wrap">
          <div class="chart-bar" style="width:${pct}%;background:${colors[i % colors.length]}"></div>
        </div>
        <span class="chart-pct">${pct}%</span>
      </div>
    `;
  });
}

// ── Live vote event listener ─────────────────────────────────
function listenForVoteEvents() {
  if (!contract) return;
  contract.on("VoteCast", (regionKey, voter, candidateId) => {
    const short = voter.slice(0, 6) + "…" + voter.slice(-4);
    const feed = document.getElementById("tx-feed");
    const item = document.createElement("div");
    item.className = "tx-item";
    item.textContent = `⛓️ ${short} voted for Candidate #${candidateId}`;
    feed.prepend(item);
    if (feed.children.length > 5) feed.lastChild.remove();
  });
}

// ═══════════════════════════════════════════════════════════════
//  UI HELPERS
// ═══════════════════════════════════════════════════════════════

function goStep(n) {
  document.querySelectorAll(".step-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".step").forEach(s => s.classList.remove("active"));
  document.getElementById(`panel-${n}`).classList.add("active");
  document.querySelector(`[data-step="${n}"]`).classList.add("active");

  if (n === 3 && selectedState && selectedConst) {
    loadCandidates(selectedState, selectedConst);
  }
}

function onStateChange() {
  const state = document.getElementById("sel-state").value;
  selectedState = state;
  const constSel = document.getElementById("sel-const");
  constSel.innerHTML = '<option value="">— Select Constituency —</option>';
  constSel.disabled = !state;

  if (state && CONFIG.CONSTITUENCIES[state]) {
    CONFIG.CONSTITUENCIES[state].forEach(c => {
      constSel.innerHTML += `<option value="${c}">${c}</option>`;
    });
  }

  document.getElementById("region-verified").classList.add("hidden");
  document.getElementById("btn-region-next").disabled = true;

  constSel.onchange = () => {
    selectedConst = constSel.value;
    const ok = !!selectedConst;
    document.getElementById("region-verified").classList.toggle("hidden", !ok);
    document.getElementById("btn-region-next").disabled = !ok;
  };
}

function showSuccessModal(fullHash, shortHash) {
  // Confetti 🎉
  if (window.confetti) {
    confetti({ particleCount: 150, spread: 80, origin: { y: 0.6 } });
  }
  const overlay = document.getElementById("modal-overlay");
  document.getElementById("modal-body").innerHTML = `
    <div style="text-align:center;padding:1rem">
      <div style="font-size:3rem">🎉</div>
      <h2>Vote Cast Successfully!</h2>
      <p>Your vote is permanently recorded on the Polygon blockchain.</p>
      <div class="info-row">
        <span>Tx Hash</span>
        <a href="${CONFIG.EXPLORER}/tx/${fullHash}" target="_blank" class="badge blue">
          ${shortHash}
        </a>
      </div>
      <p style="font-size:0.8rem;margin-top:1rem;opacity:0.6">
        🔐 Secured by Auth0 Token Vault · Zero-Trust Architecture
      </p>
      <button class="btn-primary" onclick="closeModal()" style="margin-top:1rem">Done</button>
    </div>
  `;
  overlay.classList.remove("hidden");
}

function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
}

let chatOpen = false;
function toggleChat() {
  chatOpen = !chatOpen;
  document.getElementById("chat-window").classList.toggle("hidden", !chatOpen);
  if (chatOpen && document.getElementById("chat-messages").children.length === 0) {
    appendChatMsg("bot", "👋 Hello! I'm your Secure AI Assistant powered by the Auth0 Token Vault. Ask me about candidates, polling locations, or your constituency.");
  }
}

async function sendChat() {
  const input = document.getElementById("chat-input");
  const msg = input.value.trim();
  if (!msg) return;
  input.value = "";
  appendChatMsg("user", msg);

  // Simple rule-based AI responses (upgrade to Gemini API for full AI)
  const lower = msg.toLowerCase();
  let reply = "";

  if (lower.includes("verify") || lower.includes("verified")) {
    if (signer) {
      const addr = await signer.getAddress();
      const verified = await contract?.isVerifiedVoter(addr);
      reply = verified
        ? "✅ Your wallet is verified as an eligible voter on-chain."
        : "❌ Your wallet is not yet verified. Contact the Election Commission.";
    } else {
      reply = "Please connect your wallet first to check verification status.";
    }
  } else if (lower.includes("poll") || lower.includes("booth")) {
    reply = `🗳️ Your polling booth for ${selectedConst || "your constituency"} is managed by the local ECI office. Check voterportal.eci.gov.in for exact location.`;
  } else if (lower.includes("candidate") || lower.includes("manifesto")) {
    reply = "Click '📜 Manifesto' on any candidate card to view their key promises and agenda.";
  } else if (lower.includes("blockchain") || lower.includes("transaction")) {
    reply = "All votes are recorded on the Polygon Amoy blockchain. Each transaction has a unique hash you can verify on Polygonscan.";
  } else if (lower.includes("auth0") || lower.includes("token vault") || lower.includes("secure")) {
    reply = "🔐 Auth0 Token Vault ensures your session tokens are stored server-side and never exposed to JavaScript — preventing prompt injection and token theft.";
  } else {
    reply = "I can help with: voter verification, polling booths, candidate info, and blockchain transparency. What would you like to know?";
  }

  setTimeout(() => appendChatMsg("bot", reply), 600);
}

function appendChatMsg(role, text) {
  const msgs = document.getElementById("chat-messages");
  const div = document.createElement("div");
  div.className = `chat-msg ${role}`;
  div.textContent = text;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function showManifesto(name, party) {
  const manifestos = {
    BJP: "Key promises: National security, economic development, digital India, infrastructure growth, and Uniform Civil Code.",
    INC: "Key promises: Social welfare, NYAY income guarantee, farmer loan waiver, employment guarantee, and free education.",
    AAP: "Key promises: Free electricity (200 units), world-class government schools, mohalla clinics, and anti-corruption drive.",
  };
  document.getElementById("modal-body").innerHTML = `
    <h2>📜 ${name}</h2>
    <p class="badge blue">${party}</p>
    <hr style="margin:1rem 0;opacity:0.2">
    <p>${manifestos[party] || "Manifesto details not available. Please visit the party's official website."}</p>
  `;
  document.getElementById("modal-overlay").classList.remove("hidden");
}

function showToast(message, type = "info") {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);
    padding:0.8rem 1.5rem;border-radius:0.75rem;font-size:0.9rem;
    z-index:9999;animation:fadeIn 0.3s ease;
    background:${type === "error" ? "#ef4444" : type === "info" ? "#6366f1" : "#10b981"};
    color:white;box-shadow:0 4px 20px rgba(0,0,0,0.3);
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ═══════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════

// Load ethers.js v6 from CDN
loadScript("https://cdnjs.cloudflare.com/ajax/libs/ethers/6.7.0/ethers.umd.min.js")
  .then(() => initAuth0())
  .catch(err => console.error("Failed to load ethers.js:", err));

// Wire up buttons
document.getElementById("btn-login").addEventListener("click", loginWithAuth0);
document.getElementById("btn-logout").addEventListener("click", logoutAuth0);