import { Pool } from 'pg';
import fetch from "node-fetch";
import { Alchemy, Network } from 'alchemy-sdk';
import axios from 'axios'
import dotenv from 'dotenv';
dotenv.config();

// Pool for garden_interchain_analysis
const analysisPool = new Pool({
  user: process.env.ANALYSIS_DB_USER,
  host: process.env.ANALYSIS_DB_HOST,
  database: process.env.ANALYSIS_DB_NAME,
  password: process.env.ANALYSIS_DB_PASSWORD,
  port: Number(process.env.ANALYSIS_DB_PORT),
});

// Alchemy SDK instances for supported chains
const alchemyInstances = {
  arbitrum_sepolia: new Alchemy({ apiKey: process.env.ALCHEMY_TOKEN, network: Network.ARB_SEPOLIA }),
  ethereum_sepolia: new Alchemy({ apiKey: process.env.ALCHEMY_TOKEN, network: Network.ETH_SEPOLIA }),
  base_sepolia: new Alchemy({ apiKey: process.env.ALCHEMY_TOKEN, network: Network.BASE_SEPOLIA }),
};

// Function to format timestamp to 2025-05-03 10:35:12.181+05:30 (IST)
const formatTimestampToIST = (timestampSeconds) => {
  const date = new Date(timestampSeconds * 1000);
  const isoString = date.toISOString().replace('Z', '+00:00'); // Convert to UTC ISO
  // Adjust to IST (+05:30) manually since PostgreSQL will store it as TIMESTAMPTZ
  const istOffset = 5.5 * 60 * 60 * 1000; // 5 hours 30 minutes in milliseconds
  const istDate = new Date(date.getTime() + istOffset);
  const istString = istDate.toISOString().replace('T', ' ').substring(0, 23) + '+05:30';
  return istString;
};

// Function to fetch timestamp for a block number based on the chain
const getTimestampForBlock = async (chain, blockNumber) => {
  if (!blockNumber) return null;

  // Handle Alchemy SDK chains (Arbitrum Sepolia, Ethereum Sepolia, Base Sepolia)
  if (['arbitrum_sepolia', 'ethereum_sepolia', 'base_sepolia'].includes(chain)) {
    try {
      const alchemy = alchemyInstances[chain];
      const block = await alchemy.core.getBlock(Number(blockNumber));
      if (block && block.timestamp) {
        return block.timestamp;
      }
      console.log(`Block ${blockNumber} not found for chain ${chain}`);
      return null;
    } catch (err) {
      console.error(`Error fetching block ${blockNumber} for chain ${chain}:`, err.message);
      return null;
    }
  }

  // Handle Starknet Sepolia (raw RPC call)
  if (chain === 'starknet_sepolia') {
    try {
      const rpcUrl = `${process.env.RPC_URL_STARKNET_SEPOLIA}${process.env.ALCHEMY_TOKEN}`;
      const payload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'starknet_getBlockWithTxs',
        params: [{ block_number: Number(blockNumber) }],
      };
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.result && data.result.timestamp) {
        return data.result.timestamp;
      }
      console.log(`Block ${blockNumber} not found for chain ${chain}`);
      return null;
    } catch (err) {
      console.error(`Error fetching block ${blockNumber} for chain ${chain}:`, err.message);
      return null;
    }
  }

  // Handle Monad Testnet (raw RPC call)
  if (chain === 'monad_testnet') {
    try {
      const rpcUrl = `${process.env.RPC_URL_MONAD_TESTNET}${process.env.ALCHEMY_TOKEN}`;
      const hexBlockNumber = '0x' + Number(blockNumber).toString(16);
      const payload = {
        jsonrpc: '2.0',
        method: 'eth_getBlockByNumber',
        params: [hexBlockNumber, false],
        id: 1,
      };
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.result && data.result.timestamp) {
        return parseInt(data.result.timestamp, 16);
      }
      console.log(`Block ${blockNumber} not found for chain ${chain}`);
      return null;
    } catch (err) {
      console.error(`Error fetching block ${blockNumber} for chain ${chain}:`, err.message);
      return null;
    }
  }

  // Handle Hyperliquid Testnet (axios RPC call)
  if (chain === 'hyperliquid_testnet') {
    try {
      const rpcUrl = 'https://rpc.hyperliquid-testnet.xyz/evm';
      const params = [`0x${Number(blockNumber).toString(16)}`, false];
      const response = await axios.post(rpcUrl, {
        jsonrpc: '2.0',
        method: 'eth_getBlockByNumber',
        params: params,
        id: 1,
      });
      const block = response.data.result;
      if (block && block.timestamp) {
        return parseInt(block.timestamp, 16);
      }
      console.log(`Block ${blockNumber} not found for chain ${chain}`);
      return null;
    } catch (err) {
      console.error(`Error fetching block ${blockNumber} for chain ${chain}:`, err.message);
      return null;
    }
  }

  // Chain not supported
  console.log(`Chain ${chain} not supported for timestamp fetching`);
  return null;
};

// Main function to update timestamps
const updateTimestamps = async () => {
  try {
    // Query rows where user_init or cobi_init is NULL
    const query = `
      SELECT id, source_chain, destination_chain, user_init_block_number, cobi_init_block_number
      FROM order_analysis
      WHERE user_init IS NULL OR cobi_init IS NULL
    `;
    const result = await analysisPool.query(query);
    console.log(`Found ${result.rowCount} rows with missing user_init or cobi_init timestamps`);

    for (const row of result.rows) {
      const { id, source_chain, destination_chain, user_init_block_number, cobi_init_block_number } = row;
      let userInitTimestamp = null;
      let cobiInitTimestamp = null;

      // Fetch user_init timestamp if needed
      if (user_init_block_number) {
        const timestampSeconds = await getTimestampForBlock(source_chain, user_init_block_number);
        if (timestampSeconds) {
          userInitTimestamp = formatTimestampToIST(timestampSeconds);
        }
      }

      // Fetch cobi_init timestamp if needed
      if (cobi_init_block_number) {
        const timestampSeconds = await getTimestampForBlock(destination_chain, cobi_init_block_number);
        if (timestampSeconds) {
          cobiInitTimestamp = formatTimestampToIST(timestampSeconds);
        }
      }

      // Update the row if we have at least one timestamp
      if (userInitTimestamp || cobiInitTimestamp) {
        const updateQuery = `
          UPDATE order_analysis
          SET user_init = COALESCE(user_init, $1),
              cobi_init = COALESCE(cobi_init, $2)
          WHERE id = $3
        `;
        await analysisPool.query(updateQuery, [
          userInitTimestamp,
          cobiInitTimestamp,
          id,
        ]);
        console.log(`Updated timestamps for order ${id}: user_init=${userInitTimestamp}, cobi_init=${cobiInitTimestamp}`);
      }
    }

    console.log('Timestamp update completed');
  } catch (err) {
    console.error('Error updating timestamps:', err);
  } finally {
    await analysisPool.end();
  }
};

// Run the script
updateTimestamps();