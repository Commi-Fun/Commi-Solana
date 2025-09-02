import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CommiMerkle } from "../target/types/commi_merkle";
import { MockPythPull } from "../target/types/mock_pyth_pull";
import { MockPythPush } from "../target/types/mock_pyth_push";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  createMint,
  mintTo,
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccount
} from "@solana/spl-token";
import { sha256 } from "js-sha256";
import { assert } from "chai";
import * as fs from "fs";


interface MerkleLeaf {
  claimer: PublicKey;
  amount: anchor.BN;
  nonce: anchor.BN;
}

describe("commi-merkle", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const admin = anchor.Wallet.local();
  const SOLFeedId = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

  const program = anchor.workspace.CommiMerkle as Program<CommiMerkle>;
  const pythPullProgram = anchor.workspace.MockPythPull as Program<MockPythPull>;
  const pythPushProgram = anchor.workspace.MockPythPush as Program<MockPythPush>;
  
  // Test accounts
  let launcher: Keypair;
  let distributor: Keypair;
  let claimer1: Keypair;
  let claimer2: Keypair;
  let mint: PublicKey;
  let launcherAta: PublicKey;
  let campaignPda: PublicKey;
  let vaultPda: PublicKey;
  let pythPriceAccount: Keypair;

  
  // Test constants
  const fundAmount = new anchor.BN(1000000000); // 1 billion tokens with 9 decimals
  const claimAmount1 = new anchor.BN(100000000); // 100 million tokens
  const claimAmount2 = new anchor.BN(200000000); // 200 million tokens
  
  // Merkle tree setup for launch (32 leaves)
  let launchMerkleTree: Buffer[][];
  let merkleLeaves: MerkleLeaf[] = [];

  let claimMerkleTree: Buffer[][];
  let expandedMerkleTree: Buffer[][];

  before(async () => {
    // Setup test accounts
    launcher = Keypair.generate();
    
    // Load the test distributor keypair from the file we created
    try {
      const distributorKeyData = JSON.parse(fs.readFileSync("./test-distributor.json", "utf-8"));
      distributor = Keypair.fromSecretKey(new Uint8Array(distributorKeyData));
      console.log("Distributor public key:", distributor.publicKey.toString());
    } catch (e) {
      console.error("Failed to load distributor keypair. Make sure test-distributor.json exists in project root");
      throw e;
    }
    
    claimer1 = Keypair.generate();
    claimer2 = Keypair.generate();
    
    // Airdrop SOL to test accounts
    await provider.connection.requestAirdrop(launcher.publicKey, 10 * LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(distributor.publicKey, 10 * LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(claimer1.publicKey, 10 * LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(claimer2.publicKey, 10 * LAMPORTS_PER_SOL);
    
    // Wait for airdrops to confirm
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Create mint
    mint = await createMint(
      provider.connection,
      launcher,
      launcher.publicKey,
      null,
      9 // 9 decimals
    );
    
    // Create launcher's associated token account and mint tokens
    launcherAta = await createAssociatedTokenAccount(
      provider.connection,
      launcher,
      mint,
      launcher.publicKey
    );
    
    await mintTo(
      provider.connection,
      launcher,
      mint,
      launcherAta,
      launcher,
      fundAmount.toNumber() * 2 // Mint extra for testing
    );
    
    // Derive PDAs
    const [campaign, _campaignBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("campaign"),
        launcher.publicKey.toBuffer(),
        mint.toBuffer(),
      ],
      program.programId
    );
    campaignPda = campaign;
    
    vaultPda = await getAssociatedTokenAddress(
      mint,
      campaignPda,
      true // allowOwnerOffCurve
    );
    
    // Setup mock Pyth price account
    pythPriceAccount = await setupMockPythPriceAccount();
    
    // Setup merkle trees
    setupLaunchMerkleTree();
    setupClaimMerkleTree();
  });

  async function setupMockPythPriceAccount(): Promise<Keypair> {
    // Create a mock Pyth price account
    const priceAccount = Keypair.generate();

    const tx = await pythPullProgram.methods.initialize(
      SOLFeedId, 
      new anchor.BN(20000000000), 
      new anchor.BN(10000000),
      -8,
    ).accounts({
      payer: admin.publicKey,
      price: priceAccount.publicKey,
    }).signers([priceAccount]).rpc();

    console.log("Mock pyth pull transaction signature:", tx);
    return priceAccount;
  }

  function setupLaunchMerkleTree() {
    // Generate 32 leaves for launch merkle tree
    // First leaf: launcher with fund amount
    const nonces: anchor.BN[] = [];
    
    // Generate random nonces for all 32 leaves
    for (let i = 0; i < 32; i++) {
      nonces.push(new anchor.BN(Math.floor(Math.random() * 1000000)));
    }
    
    // First leaf is the launcher
    merkleLeaves.push({
      claimer:launcher.publicKey, 
      amount: fundAmount, 
      nonce: nonces[0],
    });
    
    // Remaining 31 leaves are zero address with 0 amount
    const zeroAddress = PublicKey.default;
    for (let i = 1; i < 32; i++) {
      merkleLeaves.push({
        claimer: zeroAddress, 
        amount: new anchor.BN(0), 
        nonce: nonces[i]
      });
    }
    
    // Build merkle tree (32 leaves = 5 levels)
    launchMerkleTree = generateMerkleTree(merkleLeaves);
  }

  function getProof(merkleTree: Buffer[][], idx: number): Buffer[] {
    const proof: Buffer[] = [];
    let currentLevel = 0;
    while (merkleTree[currentLevel].length > 1) {
      const sibling = idx % 2 === 0 ? idx + 1 : idx - 1;
      proof.push(merkleTree[currentLevel][sibling]);
      currentLevel = currentLevel + 1;
      idx >>= 1;
    }
    return proof;
  }

  function verifyProof(proof: Buffer[], leaf: Buffer, idx: number,root: Buffer) {
    let current = leaf;
    for (let i = 0; i < proof.length; i++) {
      if (idx % 2 === 0) {
        current = hashPair(current, proof[i]);
      } else {
        current = hashPair(proof[i], current);
      }
      idx >>= 1;
    }
    return current.equals(root);
  }

  // TODO: optimize to update in O(logn)
  function updateMerkleTree(idx: number, claimer: PublicKey, amount: anchor.BN) {
    merkleLeaves[idx].claimer = claimer;
    merkleLeaves[idx].amount = amount;
  }

  // TODO: optimize to update for next half only
  function expandMerkleTree() {
    let curr_length = merkleLeaves.length;
    for (let i = 0; i < curr_length; i++) {
      merkleLeaves.push({
        claimer: PublicKey.default, 
        amount: new anchor.BN(0), 
        nonce: new anchor.BN(Math.floor(Math.random() * 1000000))
      });
    }
  }

  function setupClaimMerkleTree() {
    // Create leaves for two claimers
    updateMerkleTree(1, claimer1.publicKey, claimAmount1);
    updateMerkleTree(2, claimer2.publicKey, claimAmount2);
    updateMerkleTree(0, launcher.publicKey, fundAmount.sub(claimAmount1).sub(claimAmount2));
    claimMerkleTree = generateMerkleTree(merkleLeaves);
  }
  
  function createLeafHash(claimer: PublicKey, amount: anchor.BN, nonce: anchor.BN): Buffer {
    return Buffer.from(
      sha256.array(
        Buffer.concat([
          claimer.toBuffer(),
          amount.toArrayLike(Buffer, "le", 8),
          nonce.toArrayLike(Buffer, "le", 8)
        ])
      )
    );
  }
  
  function hashPair(left: Buffer, right: Buffer): Buffer {
    return Buffer.from(
      sha256.array(Buffer.concat([left, right]))
    );
  }
  
  function generateMerkleTree(leaves: MerkleLeaf[]): Buffer[][] {
    let result: Buffer[][] = [];
    let currentLevel = leaves.map(leaf => createLeafHash(leaf.claimer, leaf.amount, leaf.nonce));
    result.push(currentLevel);

    // Build tree level by level
    while (currentLevel.length > 1) {
      const nextLevel: Buffer[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        nextLevel.push(hashPair(currentLevel[i], currentLevel[i + 1]));
      }
      result.push(nextLevel);
      currentLevel = nextLevel;
    }
    return result;
  }

  describe("launch", () => {

    it("should fail when fund amount is zero", async () => {
      const zeroFund = new anchor.BN(0);
      
      // Create a merkle root for zero fund
      const zeroLeaves: MerkleLeaf[] = [];
      const zeroNonces: anchor.BN[] = [];
      for (let i = 0; i < 32; i++) {
        zeroNonces.push(new anchor.BN(Math.floor(Math.random() * 1000000)));
      }
      zeroLeaves.push({
        claimer: launcher.publicKey, 
        amount: zeroFund, 
        nonce: zeroNonces[0]
      });
      const zeroAddress = PublicKey.default;
      for (let i = 1; i < 32; i++) {
        zeroLeaves.push({
          claimer: zeroAddress, 
          amount: new anchor.BN(0), 
          nonce: zeroNonces[i]
        });
      }
      const zeroMerkleTree = generateMerkleTree(zeroLeaves);
      const zeroMerkleRoot = zeroMerkleTree[zeroMerkleTree.length - 1][0];
      
      try {
        await program.methods
          .launch(zeroFund, Array.from(zeroMerkleRoot))
          .accounts({
            launcher: launcher.publicKey,
            distributor: distributor.publicKey,
            campaign: campaignPda,
            price_update: pythPriceAccount.publicKey,
            mint: mint,
            launcherAta,
            vault: vaultPda,
            priceUpdate: pythPriceAccount.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([launcher])
          .rpc();
        
        assert.fail("Should have failed with InvalidFund error");
      } catch (error) {
        assert.include(error.toString(), "InvalidFund");
      }
    });

    it("should launch a new campaign successfully", async () => {
      const merkleRoot = launchMerkleTree[launchMerkleTree.length - 1][0];
      
      // Get balances before transaction
      const launcherBalanceBefore = await provider.connection.getBalance(launcher.publicKey);
      const distributorBalanceBefore = await provider.connection.getBalance(distributor.publicKey);
      
      const tx = await program.methods
        .launch(fundAmount, Array.from(merkleRoot))
        .accounts({
          launcher: launcher.publicKey,
          distributor: distributor.publicKey,
          campaign: campaignPda,
          price_update: pythPriceAccount.publicKey,
          mint,
          launcherAta,
          vault: vaultPda,
          priceUpdate: pythPriceAccount.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([launcher])
        .rpc();
      
      console.log("Launch transaction signature:", tx);

      await new Promise(resolve => setTimeout(resolve, 1000));
      // Get transaction details for gas consumption
      const txDetails = await provider.connection.getTransaction(tx, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0
      });
      const gasUsed = txDetails?.meta?.fee || 0;
      console.log("Gas consumed:", gasUsed, "lamports");
      
      // Get balances after transaction
      const launcherBalanceAfter = await provider.connection.getBalance(launcher.publicKey);
      const distributorBalanceAfter = await provider.connection.getBalance(distributor.publicKey);
      
      // Calculate service fee transferred (should be ~$5 worth of SOL)
      const serviceFeeTransferred = distributorBalanceAfter - distributorBalanceBefore;
      console.log("Service fee transferred:", serviceFeeTransferred, "lamports");
      
      // Verify service fee was transferred (checking it's greater than 0 and reasonable)
      // With SOL at ~$200, $5 would be ~0.025 SOL = 25,000,000 lamports
      // But since we're using mock Pyth with price 200.00000000, we expect:
      // $5 / $200 = 0.025 SOL = 25,000,000 lamports
      assert.isAbove(serviceFeeTransferred, 0, "Service fee should be transferred");
      assert.isBelow(serviceFeeTransferred, 100_000_000, "Service fee should be reasonable (less than 0.1 SOL)");
      
      // Verify campaign state
      const campaignAccount = await program.account.campaignState.fetch(campaignPda);
      assert.equal(campaignAccount.launcher.toString(), launcher.publicKey.toString());
      assert.equal(campaignAccount.mint.toString(), mint.toString());
      assert.equal(campaignAccount.fund.toString(), fundAmount.toString());
      assert.equal(
        Buffer.from(campaignAccount.merkleRoot).toString("hex"),
        merkleRoot.toString("hex")
      );
      assert.equal(campaignAccount.rewards.length, 32);
      assert.equal(campaignAccount.rewards[0].toString(), fundAmount.toString());
      
      // Verify vault received tokens
      const vaultAccount = await getAccount(provider.connection, vaultPda);
      assert.equal(vaultAccount.amount.toString(), fundAmount.toString());
    });
  });

  describe("update", () => {
    it("should update merkle root and rewards successfully", async () => {
      const claimMerkleRoot = claimMerkleTree[claimMerkleTree.length - 1][0];
      // Update rewards for claimer1 (index 1) and claimer2 (index 2)
      const participants = [
        [new anchor.BN(1), claimAmount1],
        [new anchor.BN(2), claimAmount2]
      ];
      
      const tx = await program.methods
        .update(Array.from(claimMerkleRoot), participants)
        .accounts({
          distributor: distributor.publicKey,
          launcher: launcher.publicKey,
          campaign: campaignPda,
          mint
        })
        .signers([distributor])
        .rpc();
      
      console.log("Update transaction signature:", tx);
      await new Promise(resolve => setTimeout(resolve, 1000));
      // Get transaction details for gas consumption
      const txDetails = await provider.connection.getTransaction(tx, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0
      });
      const gasUsed = txDetails?.meta?.fee || 0;
      console.log("Gas consumed:", gasUsed, "lamports");
      
      // Verify merkle root was updated and rewards were set
      const campaignAccount = await program.account.campaignState.fetch(campaignPda);
      assert.equal(
        Buffer.from(campaignAccount.merkleRoot).toString("hex"),
        claimMerkleRoot.toString("hex")
      );
      assert.equal(campaignAccount.rewards[1].toString(), claimAmount1.toString());
      assert.equal(campaignAccount.rewards[2].toString(), claimAmount2.toString());
    });
    
    it("should resize rewards array and update in single transaction", async () => {
      expandMerkleTree();
      expandedMerkleTree = generateMerkleTree(merkleLeaves);
      let expandedMerkleRoot = expandedMerkleTree[expandedMerkleTree.length - 1][0];
      const participants: any[] = []; // No new participants in this test
      
      // Create both instructions
      const extendIx = await program.methods
        .extend(new anchor.BN(132)) // Extend to 132 participants (32 + 100)
        .accounts({
          distributor: distributor.publicKey,
          campaign: campaignPda,
        })
        .instruction();
      
      const updateIx = await program.methods
        .update(Array.from(expandedMerkleRoot), participants)
        .accounts({
          distributor: distributor.publicKey,
          launcher: launcher.publicKey,
          campaign: campaignPda,
          mint
        })
        .instruction();
      
      // Send both instructions in a single transaction
      const tx = new anchor.web3.Transaction().add(extendIx, updateIx);
      const signature = await provider.sendAndConfirm(tx, [distributor]);
      
      console.log("Update with resize transaction signature:", signature);
      await new Promise(resolve => setTimeout(resolve, 1000));
      // Get transaction details for gas consumption
      const txDetails = await provider.connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0
      });
      const gasUsed = txDetails?.meta?.fee || 0;
      console.log("Gas consumed:", gasUsed, "lamports");
      
      // Verify rewards array was resized
      const campaignAccount = await program.account.campaignState.fetch(campaignPda);
      assert.equal(campaignAccount.rewards.length, 132); // Should be increased from 32 to 132 (32 + 100)
      assert.equal(
        Buffer.from(campaignAccount.merkleRoot).toString("hex"),
        expandedMerkleRoot.toString("hex")
      );
    });
    
    it("should fail with invalid distributor", async () => {
      let claimMerkleRoot = claimMerkleTree[claimMerkleTree.length - 1][0];
      const invalidDistributor = Keypair.generate();
      await provider.connection.requestAirdrop(invalidDistributor.publicKey, LAMPORTS_PER_SOL);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      try {
        await program.methods
          .update(Array.from(claimMerkleRoot), [])
          .accounts({
            distributor: invalidDistributor.publicKey,
            launcher: launcher.publicKey,
            campaign: campaignPda,
            mint
          })
          .signers([invalidDistributor])
          .rpc();
        
        assert.fail("Should have failed with InvalidDistributor error");
      } catch (error) {
        assert.include(error.toString(), "InvalidDistributor");
      }
    });
  });

  describe("claim", () => {
    it("claimer1 should claim tokens successfully", async () => {
      const claimer1Ata = await getAssociatedTokenAddress(
        mint,
        claimer1.publicKey
      );
      let proof1 = getProof(expandedMerkleTree, 1);

      const tx = await program.methods
        .claim(
          1, // user_idx for claimer1
          proof1.map(p => Array.from(p)),
          merkleLeaves[1].nonce,
        )
        .accounts({
          claimer: claimer1.publicKey,
          launcher: launcher.publicKey,
          campaign: campaignPda,
          mint,
          vault: vaultPda,
          claimerAta: claimer1Ata,
          tokenProgram: TOKEN_PROGRAM_ID
        })
        .signers([claimer1])
        .rpc();
      
      console.log("Claim transaction signature for claimer1:", tx);
      await new Promise(resolve => setTimeout(resolve, 1000));
      // Get transaction details for gas consumption
      const txDetails = await provider.connection.getTransaction(tx, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0
      });
      const gasUsed = txDetails?.meta?.fee || 0;
      console.log("Gas consumed:", gasUsed, "lamports");
      
      // Verify claimer received tokens
      const claimerAccount = await getAccount(provider.connection, claimer1Ata);
      assert.equal(claimerAccount.amount.toString(), claimAmount1.toString());
      
      // Verify rewards were updated (set to 0 after claim)
      const campaignAccount = await program.account.campaignState.fetch(campaignPda);
      assert.equal(campaignAccount.rewards[1].toString(), "0"); // Should be 0 after claim
    });
    
    it("claimer1 should fail when trying to claim again", async () => {
      const claimer1Ata = await getAssociatedTokenAddress(
        mint,
        claimer1.publicKey
      );
      let proof1 = getProof(expandedMerkleTree, 1);
      try {
        await program.methods
          .claim(
            1, // user_idx for claimer1
            proof1.map(p => Array.from(p)),
            merkleLeaves[1].nonce,
          )
          .accounts({
            claimer: claimer1.publicKey,
            launcher: launcher.publicKey,
            campaign: campaignPda,
            mint,
            vault: vaultPda,
            claimerAta: claimer1Ata,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([claimer1])
          .rpc();
        
        assert.fail("Should have failed with InvalidAmount error (already claimed)");
      } catch (error) {
        assert.include(error.toString(), "InvalidAmount"); // Since rewards[1] is now 0
      }
    });
    
    it("claimer2 should claim tokens successfully", async () => {
      const claimer2Ata = await getAssociatedTokenAddress(
        mint,
        claimer2.publicKey
      );
      let proof2 = getProof(expandedMerkleTree, 2);
      const tx = await program.methods
        .claim(
          2, // user_idx for claimer2
          proof2.map(p => Array.from(p)),
          merkleLeaves[2].nonce,
        )
        .accounts({
          claimer: claimer2.publicKey,
          launcher: launcher.publicKey,
          campaign: campaignPda,
          mint,
          vault: vaultPda,
          claimerAta: claimer2Ata,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([claimer2])
        .rpc();
      
      console.log("Claim transaction signature for claimer2:", tx);
      await new Promise(resolve => setTimeout(resolve, 1000));
      // Get transaction details for gas consumption
      const txDetails = await provider.connection.getTransaction(tx, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0
      });
      const gasUsed = txDetails?.meta?.fee || 0;
      console.log("Gas consumed:", gasUsed, "lamports");
      
      // Verify claimer received tokens
      const claimerAccount = await getAccount(provider.connection, claimer2Ata);
      assert.equal(claimerAccount.amount.toString(), claimAmount2.toString());
      
      // Verify rewards were updated (set to 0 after claim)
      const campaignAccount = await program.account.campaignState.fetch(campaignPda);
      assert.equal(campaignAccount.rewards[2].toString(), "0"); // Should be 0 after claim
    });
    
    it("should fail with invalid proof", async () => {
      const invalidClaimer = Keypair.generate();
      await provider.connection.requestAirdrop(invalidClaimer.publicKey, LAMPORTS_PER_SOL);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const invalidClaimerAta = await getAssociatedTokenAddress(
        mint,
        invalidClaimer.publicKey
      );
      let proof1 = getProof(expandedMerkleTree, 1);
      try {
        await program.methods
          .claim(
            3, // user_idx 
            proof1.map(p => Array.from(p)), // Wrong proof for this claimer
            merkleLeaves[1].nonce,
          )
          .accounts({
            claimer: invalidClaimer.publicKey,
            launcher: launcher.publicKey,
            campaign: campaignPda,
            mint,
            vault: vaultPda,
            claimerAta: invalidClaimerAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([invalidClaimer])
          .rpc();
        
        assert.fail("Should have failed with InvalidAmount error");
      } catch (error) {
        assert.include(error.toString(), "InvalidAmount");
      }
    });
    
    it("should fail with zero claim amount", async () => {
      const zeroClaimer = Keypair.generate();
      await provider.connection.requestAirdrop(zeroClaimer.publicKey, LAMPORTS_PER_SOL);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const zeroClaimerAta = await getAssociatedTokenAddress(
        mint,
        zeroClaimer.publicKey
      );
      
      try {
        await program.methods
          .claim(
            3, // user_idx with no rewards allocated
            [],
            new anchor.BN(0)
          )
          .accounts({
            claimer: zeroClaimer.publicKey,
            launcher: launcher.publicKey,
            campaign: campaignPda,
            mint,
            vault: vaultPda,
            claimerAta: zeroClaimerAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([zeroClaimer])
          .rpc();
        
        assert.fail("Should have failed with InvalidAmount error");
      } catch (error) {
        assert.include(error.toString(), "InvalidAmount");
      }
    });
  });
});