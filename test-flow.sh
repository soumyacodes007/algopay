#!/bin/bash
# Algopay Full Flow Test

echo "=== Algopay Authentication & Wallet Test ==="
echo ""

# Step 1: Login (you already did this)
echo "Step 1: Login"
echo "Command: npm run dev -- auth login ankit74850raj@gmail.com"
echo "Status: ✅ Done - Check your email for OTP"
echo ""

# Step 2: Verify OTP
echo "Step 2: Verify OTP"
echo "Command: npm run dev -- auth verify <flowId> <otp>"
echo "Example: npm run dev -- auth verify cd9f5db1-e3f8-4e56-8eb8-53cba82fe350 123456"
echo ""
echo "This will:"
echo "  - Validate your OTP"
echo "  - Create an Algorand wallet via Intermezzo"
echo "  - Return a session token"
echo "  - Save credentials to ~/.algopay/config.json"
echo ""

# Step 3: Check status
echo "Step 3: Check Wallet Status"
echo "Command: npm run dev -- status"
echo "This shows your wallet address and balance"
echo ""

# Step 4: Fund wallet
echo "Step 4: Fund Wallet (Testnet)"
echo "Command: npm run dev -- fund"
echo "This will:"
echo "  - Show your wallet address"
echo "  - Provide testnet dispenser link"
echo "  - Watch for incoming deposits"
echo ""

# Step 5: Check balance
echo "Step 5: Check Balance"
echo "Command: npm run dev -- balance"
echo "Shows ALGO and all ASA balances"
echo ""

# Step 6: Send transaction
echo "Step 6: Send Transaction"
echo "Command: npm run dev -- send 0.1 <recipient-address>"
echo "Example: npm run dev -- send 0.1 HO5HWPRTVVIKRRCVHMAPHCFDVJ2IEBOTBWM52CAY4LJ2R4OMPT225WPMTY"
echo ""

echo "=== Ready to Continue ==="
echo "Run the verify command with your OTP from email!"
