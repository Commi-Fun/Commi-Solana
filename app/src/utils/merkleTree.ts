import { sha256 } from 'js-sha256';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

export interface MerkleLeaf {
  address: string;
  amount: bigint;
  nonce: bigint;
  index: number;
}

export class MerkleTree {
  private leaves: MerkleLeaf[];
  private layers: Buffer[][];

  constructor(leaves: MerkleLeaf[] = []) {
    this.leaves = leaves;
    this.layers = [];
    if (leaves.length > 0) {
      this.buildTree();
    }
  }

  private createLeafHash(leaf: MerkleLeaf): Buffer {
    const address = new PublicKey(leaf.address);
    const amountBuffer = new BN(leaf.amount.toString()).toArrayLike(Buffer, 'le', 8);
    const nonceBuffer = new BN(leaf.nonce.toString()).toArrayLike(Buffer, 'le', 8);
    const indexBuffer = new BN(leaf.index.toString()).toArrayLike(Buffer, 'le', 8);
    return Buffer.from(
      sha256.array(
        Buffer.concat([
          address.toBuffer(),
          amountBuffer,
          indexBuffer,
          nonceBuffer
        ])
      )
    );
  }

  private hashPair(left: Buffer, right: Buffer): Buffer {
    return Buffer.from(
      sha256.array(Buffer.concat([left, right]))
    );
  }

  private buildTree(): void {
    if (this.leaves.length === 0) {
      this.layers = [];
      return;
    }

    // Ensure power of 2 leaves
    const targetSize = Math.pow(2, Math.ceil(Math.log2(this.leaves.length)));
    while (this.leaves.length < targetSize) {
      this.leaves.push({
        address: PublicKey.default.toString(),
        amount: 0n,
        nonce: BigInt(Math.floor(Math.random() * 1000000)),
        index: this.leaves.length
      });
    }

    // Create leaf hashes
    let currentLevel = this.leaves.map(leaf => this.createLeafHash(leaf));
    this.layers = [currentLevel];

    // Build tree level by level
    while (currentLevel.length > 1) {
      const nextLevel: Buffer[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = currentLevel[i + 1] || left; // Duplicate last node if odd
        nextLevel.push(this.hashPair(left, right));
      }
      this.layers.push(nextLevel);
      currentLevel = nextLevel;
    }
  }

  private updatePath(leafIndex: number): void {
    // O(log n) update - only update the path from leaf to root
    if (leafIndex >= this.leaves.length || this.layers.length === 0) {
      return;
    }

    // Update leaf hash at layer 0
    this.layers[0][leafIndex] = this.createLeafHash(this.leaves[leafIndex]);

    // Update path to root
    let currentIndex = leafIndex;
    for (let level = 0; level < this.layers.length - 1; level++) {
      const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
      const parentIndex = Math.floor(currentIndex / 2);

      // Get left and right nodes
      const left = currentIndex % 2 === 0 ? 
        this.layers[level][currentIndex] : 
        this.layers[level][siblingIndex];
      const right = currentIndex % 2 === 0 ? 
        (siblingIndex < this.layers[level].length ? this.layers[level][siblingIndex] : left) : 
        this.layers[level][currentIndex];

      // Update parent
      this.layers[level + 1][parentIndex] = this.hashPair(left, right);
      currentIndex = parentIndex;
    }
  }

  getRoot(): Buffer {
    if (this.layers.length === 0) {
      return Buffer.alloc(32);
    }
    return this.layers[this.layers.length - 1][0];
  }

  getProof(index: number): Buffer[] {
    if (index >= this.leaves.length || this.layers.length === 0) {
      return [];
    }

    const proof: Buffer[] = [];
    let currentIndex = index;

    for (let level = 0; level < this.layers.length - 1; level++) {
      const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
      
      if (siblingIndex < this.layers[level].length) {
        proof.push(this.layers[level][siblingIndex]);
      }
      
      currentIndex = Math.floor(currentIndex / 2);
    }

    return proof;
  }

  verifyProof(
    leaf: MerkleLeaf,
    proof: Buffer[],
    root: Buffer
  ): boolean {
    let computedHash = this.createLeafHash(leaf);
    let index = leaf.index;

    for (const proofElement of proof) {
      if (index % 2 === 0) {
        computedHash = this.hashPair(computedHash, proofElement);
      } else {
        computedHash = this.hashPair(proofElement, computedHash);
      }
      index = Math.floor(index / 2);
    }

    return computedHash.equals(root);
  }

  addLeaf(leaf: MerkleLeaf): void {
    leaf.index = this.leaves.length;
    this.leaves.push(leaf);
    this.buildTree();
  }

  updateLeaf(index: number, newAmount: bigint): void {
    if (index >= 0 && index < this.leaves.length) {
      this.leaves[index].amount = newAmount;
      this.updatePath(index); // O(log n) operation
    }
  }

  batchUpdateLeaf(updates: Array<{ index: number; amount: bigint }>): void {
    // Update all leaf values first
    const affectedIndices = new Set<number>();
    for (const update of updates) {
      if (update.index >= 0 && update.index < this.leaves.length) {
        this.leaves[update.index].amount = update.amount;
        affectedIndices.add(update.index);
      }
    }

    // If no valid updates, return
    if (affectedIndices.size === 0) return;

    // Update all affected leaf hashes
    for (const index of affectedIndices) {
      this.layers[0][index] = this.createLeafHash(this.leaves[index]);
    }

    // Propagate updates level by level to avoid redundant calculations
    let currentLevelIndices = affectedIndices;
    
    for (let level = 0; level < this.layers.length - 1; level++) {
      const nextLevelIndices = new Set<number>();
      
      // Process each affected index at current level
      for (const index of currentLevelIndices) {
        const parentIndex = Math.floor(index / 2);
        nextLevelIndices.add(parentIndex);
      }

      // Update all parent nodes at next level
      for (const parentIndex of nextLevelIndices) {
        const leftChildIndex = parentIndex * 2;
        const rightChildIndex = parentIndex * 2 + 1;
        
        const left = this.layers[level][leftChildIndex];
        const right = rightChildIndex < this.layers[level].length ? 
          this.layers[level][rightChildIndex] : left;
        
        this.layers[level + 1][parentIndex] = this.hashPair(left, right);
      }

      currentLevelIndices = nextLevelIndices;
    }
  }

  getLeaf(index: number): MerkleLeaf | undefined {
    return this.leaves[index];
  }

  getLeafByAddress(address: string): MerkleLeaf | undefined {
    return this.leaves.find(leaf => leaf.address === address);
  }

  getAllLeaves(): MerkleLeaf[] {
    return [...this.leaves];
  }

  getSize(): number {
    return this.leaves.length;
  }

  // Expand tree to accommodate more participants
  expand(newSize: number): void {
    const currentSize = this.leaves.length;
    if (newSize <= currentSize) return;

    for (let i = currentSize; i < newSize; i++) {
      this.leaves.push({
        address: PublicKey.default.toString(),
        amount: 0n,
        nonce: BigInt(Math.floor(Math.random() * 1000000)),
        index: i
      });
    }
    this.buildTree();
  }

  // Generate participants array for contract update
  generateParticipantsUpdate(): Array<[bigint, bigint]> {
    const participants: Array<[bigint, bigint]> = [];
    
    for (const leaf of this.leaves) {
      if (leaf.amount > 0n && leaf.address !== PublicKey.default.toString()) {
        participants.push([BigInt(leaf.index), leaf.amount]);
      }
    }
    
    return participants;
  }

  // Serialize tree for storage/transmission
  serialize(): string {
    return JSON.stringify({
      leaves: this.leaves.map(leaf => ({
        address: leaf.address,
        amount: leaf.amount.toString(),
        nonce: leaf.nonce.toString(),
        index: leaf.index
      }))
    });
  }

  // Deserialize tree from storage/transmission
  static deserialize(data: string): MerkleTree {
    const parsed = JSON.parse(data);
    const leaves = parsed.leaves.map((leaf: any) => ({
      address: leaf.address,
      amount: BigInt(leaf.amount),
      nonce: BigInt(leaf.nonce),
      index: leaf.index
    }));
    return new MerkleTree(leaves);
  }
}

