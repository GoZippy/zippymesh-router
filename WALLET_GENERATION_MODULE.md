# ZippyCoin Wallet Generation Module
**Version:** 1.0  
**Date:** 2026-03-03  
**Status:** Implementation Guide

---

## Overview

This document provides the complete wallet generation and management system for ZippyCoin users. The wallet supports both post-quantum (CRYSTALS-Dilithium) and classical (Ed25519) cryptography for maximum security and compatibility.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ZIPPYCOIN WALLET ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                     WALLET GENERATION FLOW                         │   │
│   │                                                                     │   │
│   │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐            │   │
│   │  │   Entropy   │───►│   Keypair   │───►│   Address   │            │   │
│   │  │  Generation │    │  Generation │    │  Derivation │            │   │
│   │  └─────────────┘    └──────┬──────┘    └─────────────┘            │   │
│   │                            │                                       │   │
│   │                   ┌────────┴────────┐                              │   │
│   │                   ▼                 ▼                              │   │
│   │            ┌──────────┐      ┌──────────┐                         │   │
│   │            │ Dilithium│      │  Ed25519 │                         │   │
│   │            │ (Quantum)│      │(Classical│                         │   │
│   │            │  pk: 2KB │      │  pk: 32B │                         │   │
│   │            │  sk: 4KB │      │  sk: 64B │                         │   │
│   │            └──────────┘      └──────────┘                         │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                     WALLET STRUCTURE                               │   │
│   │                                                                     │   │
│   │  {                                                                 │   │
│   │    "version": 1,                                                  │   │
│   │    "address": "0x7a3f...e9d2",  // 20-byte address                │   │
│   │    "publicKey": {                                                 │   │
│   │      "dilithium": "base64-encoded-2kb-key",                       │   │
│   │      "ed25519": "base64-encoded-32b-key"                          │   │
│   │    },                                                               │   │
│   │    "encryptedPrivateKey": "aes-256-gcm-encrypted",                │   │
│   │    "createdAt": "2026-03-03T20:00:00Z",                           │   │
│   │    "environmentEntropy": {  // Bicameral governance               │   │
│   │      "lat": 40.7128,                                              │   │
│   │      "lng": -74.0060,                                             │   │
│   │      "timestamp": 1710000000,                                     │   │
│   │      "localHash": "sha256-of-environmental-data"                  │   │
│   │    }                                                                │   │
│   │  }                                                                  │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation

### Rust Implementation (ZippyMesh Ecosystem)

```rust
// K:/Projects/ZippyMeshEcosystem/crates/blockchain/src/wallet.rs

use pqc_dilithium::{Keypair as DilithiumKeypair, PublicKey as DilithiumPublicKey, SecretKey as DilithiumSecretKey};
use ed25519_dalek::{Keypair as Ed25519Keypair, PublicKey as Ed25519PublicKey, SecretKey as Ed25519SecretKey};
use rand::rngs::OsRng;
use sha3::{Sha3_256, Digest};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use aes_gcm::aead::{Aead, NewAead};
use pbkdf2::{pbkdf2_hmac};
use sha2::Sha256;

/// ZippyCoin wallet with post-quantum security
pub struct ZippyWallet {
    pub address: String,
    pub dilithium_keypair: DilithiumKeypair,
    pub ed25519_keypair: Ed25519Keypair,
    pub environment_entropy: EnvironmentEntropy,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// Environmental data for bicameral governance
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvironmentEntropy {
    pub latitude: f64,
    pub longitude: f64,
    pub timestamp: i64,
    pub device_fingerprint: String,
    pub local_hash: String,
}

impl ZippyWallet {
    /// Generate a new wallet with environmental entropy
    pub fn generate(env_data: EnvironmentData) -> Result<Self, WalletError> {
        // 1. Collect environmental entropy
        let environment_entropy = Self::collect_entropy(env_data)?;
        
        // 2. Generate random seed from OS + environmental entropy
        let mut seed = [0u8; 64];
        OsRng.fill_bytes(&mut seed[0..32]);
        
        // Mix in environmental entropy
        let env_bytes = serde_json::to_vec(&environment_entropy)?;
        let env_hash = Sha3_256::digest(&env_bytes);
        seed[32..64].copy_from_slice(&env_hash);
        
        // 3. Generate Dilithium keypair (post-quantum)
        let dilithium_keypair = DilithiumKeypair::generate(Some(&seed[0..32]));
        
        // 4. Generate Ed25519 keypair (classical, for compatibility)
        let ed25519_keypair = Ed25519Keypair::generate(&mut OsRng);
        
        // 5. Derive address from public keys
        let address = Self::derive_address(
            &dilithium_keypair.public_key(),
            &ed25519_keypair.public_key()
        );
        
        Ok(Self {
            address,
            dilithium_keypair,
            ed25519_keypair,
            environment_entropy,
            created_at: chrono::Utc::now(),
        })
    }
    
    /// Derive ZippyCoin address from public keys
    fn derive_address(
        dilithium_pk: &DilithiumPublicKey,
        ed25519_pk: &Ed25519PublicKey
    ) -> String {
        // Combine both public keys
        let mut hasher = Sha3_256::new();
        hasher.update(dilithium_pk.as_bytes());
        hasher.update(ed25519_pk.as_bytes());
        
        // Take last 20 bytes (Ethereum-compatible)
        let hash = hasher.finalize();
        let address_bytes = &hash[12..32];
        
        // Format as hex with 0x prefix
        format!("0x{}", hex::encode(address_bytes))
    }
    
    /// Collect environmental entropy
    fn collect_entropy(data: EnvironmentData) -> Result<EnvironmentEntropy, WalletError> {
        // Create hash of environmental data
        let env_string = format!(
            "{:.4}:{:.4}:{}:{}",
            data.latitude,
            data.longitude,
            data.timestamp,
            data.device_id
        );
        let local_hash = hex::encode(Sha3_256::digest(env_string.as_bytes()));
        
        Ok(EnvironmentEntropy {
            latitude: data.latitude,
            longitude: data.longitude,
            timestamp: data.timestamp,
            device_fingerprint: data.device_id,
            local_hash,
        })
    }
    
    /// Sign transaction with both algorithms (hybrid signature)
    pub fn sign_transaction(&self, tx: &Transaction) -> Result<HybridSignature, WalletError> {
        let tx_hash = Self::hash_transaction(tx);
        
        // Sign with Dilithium (post-quantum)
        let dilithium_sig = self.dilithium_keypair.sign(&tx_hash);
        
        // Sign with Ed25519 (classical)
        let ed25519_sig = self.ed25519_keypair.sign(&tx_hash);
        
        Ok(HybridSignature {
            dilithium_signature: dilithium_sig.to_bytes().to_vec(),
            ed25519_signature: ed25519_sig.to_bytes().to_vec(),
            public_key_dilithium: self.dilithium_keypair.public_key().as_bytes().to_vec(),
            public_key_ed25519: self.ed25519_keypair.public_key().to_bytes().to_vec(),
        })
    }
    
    /// Verify a hybrid signature
    pub fn verify_signature(
        tx: &Transaction,
        signature: &HybridSignature,
    ) -> Result<bool, WalletError> {
        let tx_hash = Self::hash_transaction(tx);
        
        // Verify Dilithium signature
        let dilithium_pk = DilithiumPublicKey::from_bytes(&signature.public_key_dilithium)?;
        let dilithium_sig = pqc_dilithium::Signature::from_bytes(&signature.dilithium_signature)?;
        let dilithium_valid = dilithium_pk.verify(&tx_hash, &dilithium_sig)?;
        
        // Verify Ed25519 signature
        let ed25519_pk = Ed25519PublicKey::from_bytes(&signature.public_key_ed25519)?;
        let ed25519_sig = ed25519_dalek::Signature::from_bytes(&signature.ed25519_signature)?;
        let ed25519_valid = ed25519_pk.verify(&tx_hash, &ed25519_sig).is_ok();
        
        // Both must be valid
        Ok(dilithium_valid && ed25519_valid)
    }
    
    fn hash_transaction(tx: &Transaction) -> Vec<u8> {
        let mut hasher = Sha3_256::new();
        hasher.update(&tx.from);
        hasher.update(&tx.to);
        hasher.update(&tx.amount.to_le_bytes());
        hasher.update(&tx.nonce.to_le_bytes());
        hasher.update(&tx.gas_price.to_le_bytes());
        hasher.update(&tx.gas_limit.to_le_bytes());
        hasher.update(&tx.data);
        hasher.finalize().to_vec()
    }
    
    /// Encrypt wallet for storage
    pub fn encrypt(&self, password: &str) -> Result<EncryptedWallet, WalletError> {
        // Derive key from password using PBKDF2
        let mut key = [0u8; 32];
        pbkdf2_hmac::<Sha256>(
            password.as_bytes(),
            &self.address.as_bytes(), // Use address as salt
            100_000, // 100k iterations
            &mut key
        );
        
        let cipher = Aes256Gcm::new(Key::from_slice(&key));
        
        // Serialize private keys
        let private_data = WalletPrivateData {
            dilithium_secret: self.dilithium_keypair.secret_key().as_bytes().to_vec(),
            ed25519_secret: self.ed25519_keypair.secret_key().as_bytes().to_vec(),
        };
        let plaintext = serde_json::to_vec(&private_data)?;
        
        // Generate random nonce
        let nonce_bytes = rand::random::<[u8; 12]>();
        let nonce = Nonce::from_slice(&nonce_bytes);
        
        // Encrypt
        let ciphertext = cipher.encrypt(nonce, plaintext.as_ref())?;
        
        Ok(EncryptedWallet {
            version: 1,
            address: self.address.clone(),
            public_keys: PublicKeys {
                dilithium: self.dilithium_keypair.public_key().as_bytes().to_vec(),
                ed25519: self.ed25519_keypair.public_key().to_bytes().to_vec(),
            },
            encrypted_private_key: ciphertext,
            nonce: nonce_bytes.to_vec(),
            environment_entropy: self.environment_entropy.clone(),
            created_at: self.created_at,
        })
    }
    
    /// Decrypt wallet from storage
    pub fn decrypt(encrypted: &EncryptedWallet, password: &str) -> Result<Self, WalletError> {
        // Derive key
        let mut key = [0u8; 32];
        pbkdf2_hmac::<Sha256>(
            password.as_bytes(),
            encrypted.address.as_bytes(),
            100_000,
            &mut key
        );
        
        let cipher = Aes256Gcm::new(Key::from_slice(&key));
        let nonce = Nonce::from_slice(&encrypted.nonce);
        
        // Decrypt
        let plaintext = cipher.decrypt(nonce, encrypted.encrypted_private_key.as_ref())?;
        let private_data: WalletPrivateData = serde_json::from_slice(&plaintext)?;
        
        // Reconstruct keypairs
        let dilithium_secret = DilithiumSecretKey::from_bytes(&private_data.dilithium_secret)?;
        let dilithium_public = DilithiumPublicKey::from_bytes(&encrypted.public_keys.dilithium)?;
        let dilithium_keypair = DilithiumKeypair::from_keys(dilithium_public, dilithium_secret);
        
        let ed25519_secret = Ed25519SecretKey::from_bytes(&private_data.ed25519_secret)?;
        let ed25519_public = Ed25519PublicKey::from_bytes(&encrypted.public_keys.ed25519)?;
        let ed25519_keypair = Ed25519Keypair { public: ed25519_public, secret: ed25519_secret };
        
        Ok(Self {
            address: encrypted.address.clone(),
            dilithium_keypair,
            ed25519_keypair,
            environment_entropy: encrypted.environment_entropy.clone(),
            created_at: encrypted.created_at,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HybridSignature {
    pub dilithium_signature: Vec<u8>,
    pub ed25519_signature: Vec<u8>,
    pub public_key_dilithium: Vec<u8>,
    pub public_key_ed25519: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedWallet {
    pub version: u32,
    pub address: String,
    pub public_keys: PublicKeys,
    pub encrypted_private_key: Vec<u8>,
    pub nonce: Vec<u8>,
    pub environment_entropy: EnvironmentEntropy,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicKeys {
    pub dilithium: Vec<u8>,
    pub ed25519: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WalletPrivateData {
    dilithium_secret: Vec<u8>,
    ed25519_secret: Vec<u8>,
}

pub struct EnvironmentData {
    pub latitude: f64,
    pub longitude: f64,
    pub timestamp: i64,
    pub device_id: String,
}
```

---

### TypeScript/JavaScript Implementation (ZippyMesh LLM Router)

```typescript
// K:/Projects/ZippyMesh_LLM_Router/src/lib/wallet/zippycoin-wallet.ts

import { generateKeyPair, sign, verify } from 'ed25519-universal';
import { dilithium } from 'pqc-dilithium';
import { sha3_256 } from 'js-sha3';
import { pbkdf2 } from 'pbkdf2';
import { encrypt, decrypt } from './crypto-utils';

export interface WalletConfig {
  useQuantum?: boolean;
  password?: string;
  environmentalEntropy?: boolean;
}

export interface EnvironmentData {
  latitude: number;
  longitude: number;
  timestamp: number;
  deviceId: string;
}

export class ZippyWallet {
  public address: string;
  public publicKey: {
    dilithium?: Uint8Array;
    ed25519: Uint8Array;
  };
  public environmentEntropy?: EnvironmentEntropy;
  
  private dilithiumKeyPair?: any;
  private ed25519KeyPair: { publicKey: Uint8Array; secretKey: Uint8Array };
  private createdAt: Date;

  constructor(
    address: string,
    ed25519KeyPair: { publicKey: Uint8Array; secretKey: Uint8Array },
    dilithiumKeyPair?: any,
    environmentEntropy?: EnvironmentEntropy
  ) {
    this.address = address;
    this.ed25519KeyPair = ed25519KeyPair;
    this.dilithiumKeyPair = dilithiumKeyPair;
    this.publicKey = {
      dilithium: dilithiumKeyPair?.publicKey,
      ed25519: ed25519KeyPair.publicKey,
    };
    this.environmentEntropy = environmentEntropy;
    this.createdAt = new Date();
  }

  /**
   * Generate a new ZippyCoin wallet
   */
  static async generate(
    envData: EnvironmentData,
    config: WalletConfig = {}
  ): Promise<ZippyWallet> {
    const useQuantum = config.useQuantum !== false; // Default true
    
    // 1. Collect environmental entropy
    const environmentEntropy = config.environmentalEntropy !== false 
      ? await ZippyWallet.collectEntropy(envData)
      : undefined;
    
    // 2. Generate Ed25519 keypair (always)
    const ed25519KeyPair = await generateKeyPair();
    
    // 3. Generate Dilithium keypair (post-quantum)
    let dilithiumKeyPair;
    if (useQuantum) {
      // Seed from environmental data
      const seed = environmentEntropy 
        ? sha3_256(JSON.stringify(environmentEntropy))
        : undefined;
      dilithiumKeyPair = await dilithium.keyPair(seed);
    }
    
    // 4. Derive address
    const address = ZippyWallet.deriveAddress(
      dilithiumKeyPair?.publicKey,
      ed25519KeyPair.publicKey
    );
    
    return new ZippyWallet(
      address,
      ed25519KeyPair,
      dilithiumKeyPair,
      environmentEntropy
    );
  }

  /**
   * Collect environmental entropy for bicameral governance
   */
  private static async collectEntropy(data: EnvironmentData): Promise<EnvironmentEntropy> {
    const envString = `${data.latitude.toFixed(4)}:${data.longitude.toFixed(4)}:${data.timestamp}:${data.deviceId}`;
    const localHash = sha3_256(envString);
    
    return {
      latitude: data.latitude,
      longitude: data.longitude,
      timestamp: data.timestamp,
      deviceFingerprint: data.deviceId,
      localHash,
    };
  }

  /**
   * Derive wallet address from public keys
   */
  private static deriveAddress(
    dilithiumPublicKey?: Uint8Array,
    ed25519PublicKey?: Uint8Array
  ): string {
    const hasher = sha3_256.create();
    
    if (dilithiumPublicKey) {
      hasher.update(dilithiumPublicKey);
    }
    if (ed25519PublicKey) {
      hasher.update(ed25519PublicKey);
    }
    
    const hash = hasher.hex();
    // Take last 40 characters (20 bytes) for Ethereum-compatible address
    const address = '0x' + hash.slice(-40);
    
    return address;
  }

  /**
   * Sign a transaction with hybrid signature
   */
  async signTransaction(transaction: Transaction): Promise<HybridSignature> {
    const txHash = ZippyWallet.hashTransaction(transaction);
    
    // Sign with Ed25519
    const ed25519Signature = await sign(txHash, this.ed25519KeyPair.secretKey);
    
    // Sign with Dilithium (if available)
    let dilithiumSignature;
    if (this.dilithiumKeyPair) {
      dilithiumSignature = await dilithium.sign(txHash, this.dilithiumKeyPair);
    }
    
    return {
      dilithiumSignature,
      ed25519Signature,
      publicKeyDilithium: this.publicKey.dilithium,
      publicKeyEd25519: this.publicKey.ed25519,
    };
  }

  /**
   * Sign a message (for authentication)
   */
  async signMessage(message: string): Promise<string> {
    const messageBytes = new TextEncoder().encode(message);
    const signature = await sign(messageBytes, this.ed25519KeyPair.secretKey);
    return Buffer.from(signature).toString('base64');
  }

  /**
   * Hash a transaction
   */
  private static hashTransaction(tx: Transaction): Uint8Array {
    const hasher = sha3_256.create();
    hasher.update(tx.from);
    hasher.update(tx.to);
    hasher.update(tx.amount.toString());
    hasher.update(tx.nonce.toString());
    hasher.update(tx.gasPrice.toString());
    hasher.update(tx.gasLimit.toString());
    hasher.update(tx.data || '');
    
    const hashHex = hasher.hex();
    return Buffer.from(hashHex, 'hex');
  }

  /**
   * Export wallet to encrypted JSON
   */
  async export(password: string): Promise<EncryptedWallet> {
    const privateData: WalletPrivateData = {
      ed25519SecretKey: Buffer.from(this.ed25519KeyPair.secretKey).toString('base64'),
      dilithiumSecretKey: this.dilithiumKeyPair 
        ? Buffer.from(this.dilithiumKeyPair.secretKey).toString('base64')
        : undefined,
    };
    
    // Encrypt with PBKDF2 + AES-256-GCM
    const encrypted = await encrypt(
      JSON.stringify(privateData),
      password,
      this.address // Use address as salt
    );
    
    return {
      version: 1,
      address: this.address,
      publicKeys: {
        dilithium: this.publicKey.dilithium 
          ? Buffer.from(this.publicKey.dilithium).toString('base64')
          : undefined,
        ed25519: Buffer.from(this.publicKey.ed25519).toString('base64'),
      },
      encryptedPrivateKey: encrypted.ciphertext,
      nonce: encrypted.nonce,
      environmentEntropy: this.environmentEntropy,
      createdAt: this.createdAt.toISOString(),
    };
  }

  /**
   * Import wallet from encrypted JSON
   */
  static async import(
    encryptedWallet: EncryptedWallet, 
    password: string
  ): Promise<ZippyWallet> {
    // Decrypt private keys
    const decrypted = await decrypt(
      encryptedWallet.encryptedPrivateKey,
      password,
      encryptedWallet.address,
      encryptedWallet.nonce
    );
    
    const privateData: WalletPrivateData = JSON.parse(decrypted);
    
    // Reconstruct Ed25519 keypair
    const ed25519SecretKey = new Uint8Array(
      Buffer.from(privateData.ed25519SecretKey, 'base64')
    );
    const ed25519PublicKey = new Uint8Array(
      Buffer.from(encryptedWallet.publicKeys.ed25519, 'base64')
    );
    
    // Reconstruct Dilithium keypair (if present)
    let dilithiumKeyPair;
    if (privateData.dilithiumSecretKey && encryptedWallet.publicKeys.dilithium) {
      dilithiumKeyPair = {
        secretKey: new Uint8Array(Buffer.from(privateData.dilithiumSecretKey, 'base64')),
        publicKey: new Uint8Array(Buffer.from(encryptedWallet.publicKeys.dilithium, 'base64')),
      };
    }
    
    return new ZippyWallet(
      encryptedWallet.address,
      { publicKey: ed25519PublicKey, secretKey: ed25519SecretKey },
      dilithiumKeyPair,
      encryptedWallet.environmentEntropy
    );
  }

  /**
   * Get wallet balance from blockchain
   */
  async getBalance(rpcUrl: string = 'http://localhost:8545'): Promise<string> {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [this.address, 'latest'],
        id: 1,
      }),
    });
    
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    
    // Convert from wei to ZippyCoin
    const balanceWei = parseInt(data.result, 16);
    return (balanceWei / 10**18).toString();
  }

  /**
   * Send transaction to blockchain
   */
  async sendTransaction(
    to: string,
    amount: string,
    rpcUrl: string = 'http://localhost:8545'
  ): Promise<string> {
    // Get nonce
    const nonceResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getTransactionCount',
        params: [this.address, 'pending'],
        id: 1,
      }),
    });
    const nonceData = await nonceResponse.json();
    const nonce = parseInt(nonceData.result, 16);
    
    // Build transaction
    const tx: Transaction = {
      from: this.address,
      to,
      amount: BigInt(parseFloat(amount) * 10**18),
      nonce,
      gasPrice: BigInt(20000000000), // 20 gwei
      gasLimit: BigInt(21000),
      data: '0x',
    };
    
    // Sign transaction
    const signature = await this.signTransaction(tx);
    
    // Submit to blockchain
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_sendRawTransaction',
        params: [signature],
        id: 1,
      }),
    });
    
    const result = await response.json();
    if (result.error) throw new Error(result.error.message);
    
    return result.result; // Transaction hash
  }
}

// Types
export interface EnvironmentEntropy {
  latitude: number;
  longitude: number;
  timestamp: number;
  deviceFingerprint: string;
  localHash: string;
}

export interface HybridSignature {
  dilithiumSignature?: Uint8Array;
  ed25519Signature: Uint8Array;
  publicKeyDilithium?: Uint8Array;
  publicKeyEd25519: Uint8Array;
}

export interface EncryptedWallet {
  version: number;
  address: string;
  publicKeys: {
    dilithium?: string;
    ed25519: string;
  };
  encryptedPrivateKey: string;
  nonce: string;
  environmentEntropy?: EnvironmentEntropy;
  createdAt: string;
}

interface WalletPrivateData {
  ed25519SecretKey: string;
  dilithiumSecretKey?: string;
}

interface Transaction {
  from: string;
  to: string;
  amount: bigint;
  nonce: number;
  gasPrice: bigint;
  gasLimit: bigint;
  data: string;
}
```

---

## Usage Examples

### Generate New Wallet

```typescript
// In ZippyMesh LLM Router
import { ZippyWallet } from './lib/wallet/zippycoin-wallet';

// Get user's location (with permission)
const position = await navigator.geolocation.getCurrentPosition();

const wallet = await ZippyWallet.generate({
  latitude: position.coords.latitude,
  longitude: position.coords.longitude,
  timestamp: Date.now(),
  deviceId: await getDeviceFingerprint(),
}, {
  useQuantum: true,
  environmentalEntropy: true,
});

console.log('New wallet address:', wallet.address);

// Export encrypted wallet for storage
const encrypted = await wallet.export('user-password');
localStorage.setItem('zippyWallet', JSON.stringify(encrypted));
```

### Import Existing Wallet

```typescript
const encryptedJson = localStorage.getItem('zippyWallet');
const encryptedWallet = JSON.parse(encryptedJson);

const wallet = await ZippyWallet.import(encryptedWallet, 'user-password');

// Check balance
const balance = await wallet.getBalance('http://10.0.97.100:8545');
console.log('Balance:', balance, 'ZIP');
```

### Sign and Send Transaction

```typescript
// Send payment to provider
const txHash = await wallet.sendTransaction(
  '0xproviderAddress...',
  '0.001', // amount in ZIP
  'http://10.0.97.100:8545'
);

console.log('Transaction sent:', txHash);
```

---

## Security Best Practices

1. **Never store unencrypted private keys**
2. **Use strong passwords (12+ characters)**
3. **Enable environmental entropy for bicameral governance**
4. **Backup encrypted wallet JSON in multiple locations**
5. **Verify addresses before sending transactions**
6. **Use quantum-resistant signatures for high-value transactions**

---

**END OF WALLET GENERATION MODULE**
