import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CommiMerkle } from "../target/types/commi_merkle";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccount
} from "@solana/spl-token";
import { keccak256 } from "js-sha3";
import { assert } from "chai";
import * as fs from "fs";

describe("commi-merkle", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.CommiMerkle as Program<CommiMerkle>;
  
  // Test accounts
  let launcher: Keypair;
  let distributor: Keypair;
  let claimer1: Keypair;
  let claimer2: Keypair;
  let mint: PublicKey;
  let launcherAta: PublicKey;
  let campaignPda: PublicKey;
  let vaultPda: PublicKey;
  
  // Test constants
  const seed = new anchor.BN(1234567890);
  const fundAmount = new anchor.BN(1000000000); // 1 billion tokens with 9 decimals
  const claimAmount1 = new anchor.BN(100000000); // 100 million tokens
  const claimAmount2 = new anchor.BN(200000000); // 200 million tokens
  
  // Merkle tree setup for launch (32 leaves)
  let launchMerkleRoot: Buffer;
  let launchNonces: anchor.BN[] = [];
  
  // Merkle tree setup for claims
  let claimMerkleRoot: Buffer;
  let claimNonce1 = new anchor.BN(1001);
  let claimNonce2 = new anchor.BN(1002);
  let proof1: Buffer[];
  let proof2: Buffer[];

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
    
    // Setup merkle trees
    setupLaunchMerkleTree();
    setupClaimMerkleTree();
  });

  function setupLaunchMerkleTree() {
    // Generate 32 leaves for launch merkle tree
    // First leaf: launcher with fund amount
    const leaves: Buffer[] = [];
    
    // Generate random nonces for all 32 leaves
    for (let i = 0; i < 32; i++) {
      launchNonces.push(new anchor.BN(Math.floor(Math.random() * 1000000)));
    }
    
    // First leaf is the launcher
    leaves.push(createLeaf(launcher.publicKey, fundAmount, launchNonces[0]));
    
    // Remaining 31 leaves are zero address with 0 amount
    const zeroAddress = PublicKey.default;
    for (let i = 1; i < 32; i++) {
      leaves.push(createLeaf(zeroAddress, new anchor.BN(0), launchNonces[i]));
    }
    
    // Build merkle tree (32 leaves = 5 levels)
    launchMerkleRoot = buildMerkleTree(leaves);
  }

  function setupClaimMerkleTree() {
    // Create leaves for two claimers
    const leaf1 = createLeaf(claimer1.publicKey, claimAmount1, claimNonce1);
    const leaf2 = createLeaf(claimer2.publicKey, claimAmount2, claimNonce2);
    
    // Build a simple 2-leaf merkle tree
    const hash12 = hashPair(leaf1, leaf2);
    claimMerkleRoot = hash12;
    
    // Generate proofs
    proof1 = [leaf2]; // Proof for claimer1 is leaf2
    proof2 = [leaf1]; // Proof for claimer2 is leaf1
  }
  
  function createLeaf(claimer: PublicKey, amount: anchor.BN, nonce: anchor.BN): Buffer {
    return Buffer.from(
      keccak256.array(
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
      keccak256.array(Buffer.concat([left, right]))
    );
  }
  
  function buildMerkleTree(leaves: Buffer[]): Buffer {
    if (leaves.length !== 32) {
      throw new Error("Expected exactly 32 leaves");
    }
    
    let currentLevel = leaves;
    
    // Build tree level by level
    while (currentLevel.length > 1) {
      const nextLevel: Buffer[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        nextLevel.push(hashPair(currentLevel[i], currentLevel[i + 1]));
      }
      currentLevel = nextLevel;
    }
    
    return currentLevel[0];
  }

  describe("launch", () => {
    it("should launch a new campaign successfully", async () => {
      const tx = await program.methods
        .launch(fundAmount, Array.from(launchMerkleRoot))
        .accounts({
          launcher: launcher.publicKey,
          mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([launcher])
        .rpc();
      
      console.log("Launch transaction signature:", tx);
      
      // Verify campaign state
      const campaignAccount = await program.account.campaignState.fetch(campaignPda);
      assert.equal(campaignAccount.mint.toString(), mint.toString());
      assert.equal(campaignAccount.fund.toString(), fundAmount.toString());
      assert.equal(
        Buffer.from(campaignAccount.merkleRoot).toString("hex"),
        launchMerkleRoot.toString("hex")
      );
      assert.equal(campaignAccount.bitMap.length, 4);
      
      // Verify vault received tokens
      const vaultAccount = await getAccount(provider.connection, vaultPda);
      assert.equal(vaultAccount.amount.toString(), fundAmount.toString());
    });
    
    it("should fail when fund amount is zero", async () => {
      const zeroFund = new anchor.BN(0);
      const newSeed = new anchor.BN(9999);
      
      const [newCampaign, _] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("campaign"),
          launcher.publicKey.toBuffer(),
          mint.toBuffer(),
        ],
        program.programId
      );
      
      
      // Create a merkle root for zero fund
      const zeroLeaves: Buffer[] = [];
      const zeroNonces: anchor.BN[] = [];
      for (let i = 0; i < 32; i++) {
        zeroNonces.push(new anchor.BN(Math.floor(Math.random() * 1000000)));
      }
      zeroLeaves.push(createLeaf(launcher.publicKey, zeroFund, zeroNonces[0]));
      const zeroAddress = PublicKey.default;
      for (let i = 1; i < 32; i++) {
        zeroLeaves.push(createLeaf(zeroAddress, new anchor.BN(0), zeroNonces[i]));
      }
      const zeroMerkleRoot = buildMerkleTree(zeroLeaves);
      
      try {
        await program.methods
          .launch(zeroFund, Array.from(zeroMerkleRoot))
          .accounts({
            launcher: launcher.publicKey,
            mint: mint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([launcher])
          .rpc();
        
        assert.fail("Should have failed with InvalidFund error");
      } catch (error) {
        assert.include(error.toString(), "InvalidFund");
      }
    });
  });

  describe("update", () => {
    it("should update merkle root successfully", async () => {
      const tx = await program.methods
        .update(Array.from(claimMerkleRoot), false)
        .accounts({
          distributor: distributor.publicKey,
          launcher: launcher.publicKey,
          campaign: campaignPda,
          mint
        })
        .signers([distributor])
        .rpc();
      
      console.log("Update transaction signature:", tx);
      
      // Verify merkle root was updated
      const campaignAccount = await program.account.campaignState.fetch(campaignPda);
      assert.equal(
        Buffer.from(campaignAccount.merkleRoot).toString("hex"),
        claimMerkleRoot.toString("hex")
      );
    });
    
    it("should resize bitmap when flag is true", async () => {
      const tx = await program.methods
        .update(Array.from(claimMerkleRoot), true)
        .accounts({
          distributor: distributor.publicKey,
        })
        .signers([distributor])
        .rpc();
      
      console.log("Update with resize transaction signature:", tx);
      
      // Verify bitmap was resized
      const campaignAccount = await program.account.campaignState.fetch(campaignPda);
      assert.equal(campaignAccount.bitMap.length, 8); // Should be doubled from 4 to 8
    });
    
    it("should fail with invalid distributor", async () => {
      const invalidDistributor = Keypair.generate();
      await provider.connection.requestAirdrop(invalidDistributor.publicKey, LAMPORTS_PER_SOL);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      try {
        await program.methods
          .update(Array.from(claimMerkleRoot), false)
          .accounts({
            distributor: invalidDistributor.publicKey,
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
      
      const tx = await program.methods
        .claim(
          claimAmount1,
          0, // user_idx for claimer1
          proof1.map(p => Array.from(p)),
          claimNonce1
        )
        .accounts({
          claimer: claimer1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID
        })
        .signers([claimer1])
        .rpc();
      
      console.log("Claim transaction signature for claimer1:", tx);
      
      // Verify claimer received tokens
      const claimerAccount = await getAccount(provider.connection, claimer1Ata);
      assert.equal(claimerAccount.amount.toString(), claimAmount1.toString());
      
      // Verify bitmap was updated
      const campaignAccount = await program.account.campaignState.fetch(campaignPda);
      assert.equal((campaignAccount.bitMap[0] & 1), 1); // First bit should be set
    });
    
    it("claimer1 should fail when trying to claim again", async () => {
      const claimer1Ata = await getAssociatedTokenAddress(
        mint,
        claimer1.publicKey
      );
      
      try {
        await program.methods
          .claim(
            claimAmount1,
            0, // user_idx for claimer1
            proof1.map(p => Array.from(p)),
            claimNonce1
          )
          .accounts({
            claimer: claimer1.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([claimer1])
          .rpc();
        
        assert.fail("Should have failed with AlreadyClaimed error");
      } catch (error) {
        assert.include(error.toString(), "AlreadyClaimed");
      }
    });
    
    it("claimer2 should claim tokens successfully", async () => {
      const claimer2Ata = await getAssociatedTokenAddress(
        mint,
        claimer2.publicKey
      );
      
      const tx = await program.methods
        .claim(
          claimAmount2,
          1, // user_idx for claimer2
          proof2.map(p => Array.from(p)),
          claimNonce2
        )
        .accounts({
          claimer: claimer2.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([claimer2])
        .rpc();
      
      console.log("Claim transaction signature for claimer2:", tx);
      
      // Verify claimer received tokens
      const claimerAccount = await getAccount(provider.connection, claimer2Ata);
      assert.equal(claimerAccount.amount.toString(), claimAmount2.toString());
      
      // Verify bitmap was updated
      const campaignAccount = await program.account.campaignState.fetch(campaignPda);
      assert.equal((campaignAccount.bitMap[0] & 2), 2); // Second bit should be set
    });
    
    it("should fail with invalid proof", async () => {
      const invalidClaimer = Keypair.generate();
      await provider.connection.requestAirdrop(invalidClaimer.publicKey, LAMPORTS_PER_SOL);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const invalidClaimerAta = await getAssociatedTokenAddress(
        mint,
        invalidClaimer.publicKey
      );
      
      try {
        await program.methods
          .claim(
            claimAmount1,
            2, // user_idx 
            proof1.map(p => Array.from(p)), // Wrong proof for this claimer
            claimNonce1
          )
          .accounts({
            claimer: invalidClaimer.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([invalidClaimer])
          .rpc();
        
        assert.fail("Should have failed with InvalidProof error");
      } catch (error) {
        assert.include(error.toString(), "InvalidProof");
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
            new anchor.BN(0), // Zero amount
            3,
            [],
            new anchor.BN(0)
          )
          .accounts({
            claimer: zeroClaimer.publicKey,
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