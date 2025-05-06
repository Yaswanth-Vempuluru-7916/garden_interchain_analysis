import express, { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Pool for stage_db (source data)
const stagePool = new Pool({
  user: process.env.STAGE_DB_USER,
  host: process.env.STAGE_DB_HOST,
  database: process.env.STAGE_DB_NAME,
  password: process.env.STAGE_DB_PASSWORD,
  port: Number(process.env.STAGE_DB_PORT),
});

// Pool for garden_interchain_analysis (storing results)
const analysisPool = new Pool({
  user: process.env.ANALYSIS_DB_USER,
  host: process.env.ANALYSIS_DB_HOST,
  database: process.env.ANALYSIS_DB_NAME,
  password: process.env.ANALYSIS_DB_PASSWORD,
  port: Number(process.env.ANALYSIS_DB_PORT),
});

// Initialize order_analysis table
const initTable = async () => {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS order_analysis (
      id SERIAL PRIMARY KEY,
      create_order_id TEXT NOT NULL,
      source_swap_id TEXT NOT NULL,
      destination_swap_id TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL,
      source_chain TEXT NOT NULL,
      destination_chain TEXT NOT NULL,
      user_init TEXT,
      cobi_init TEXT,
      user_redeem TIMESTAMP WITH TIME ZONE,
      cobi_redeem TIMESTAMP WITH TIME ZONE,
      user_refund TIMESTAMP WITH TIME ZONE,
      cobi_refund TIMESTAMP WITH TIME ZONE,
      secret_hash TEXT,
      user_init_block_number BIGINT,
      user_redeem_block_number BIGINT,
      user_refund_block_number BIGINT,
      cobi_init_block_number BIGINT,
      cobi_redeem_block_number BIGINT,
      cobi_refund_block_number BIGINT
    );
  `;
  try {
    await analysisPool.query(createTableQuery);
    console.log('order_analysis table created with TIMESTAMPTZ columns, secret_hash, block numbers, and chain columns');
  } catch (err) {
    console.error('Failed to create order_analysis table:', err);
  }
};

// Populate order_analysis with all completed orders from stage_db
const populateOrderAnalysis = async () => {
  const query = `
    SELECT DISTINCT
        mo.create_order_id,
        mo.source_swap_id,
        mo.destination_swap_id,
        co.created_at,
        co.source_chain,
        co.destination_chain,
        s1.updated_at AS source_updated_at,
        s1.redeem_tx_hash AS source_redeem_tx_hash,
        s1.refund_tx_hash AS source_refund_tx_hash,
        s1.initiate_block_number AS source_init_block_number,
        s1.redeem_block_number AS source_redeem_block_number,
        s1.refund_block_number AS source_refund_block_number,
        s2.updated_at AS destination_updated_at,
        s2.redeem_tx_hash AS destination_redeem_tx_hash,
        s2.refund_tx_hash AS destination_refund_tx_hash,
        s2.initiate_block_number AS destination_init_block_number,
        s2.redeem_block_number AS destination_redeem_block_number,
        s2.refund_block_number AS destination_refund_block_number,
        co.secret_hash
    FROM create_orders co
    INNER JOIN matched_orders mo ON co.create_id = mo.create_order_id
    INNER JOIN swaps s1 ON mo.source_swap_id = s1.swap_id
    INNER JOIN swaps s2 ON mo.destination_swap_id = s2.swap_id
    WHERE (s1.redeem_tx_hash IS NOT NULL AND s1.redeem_tx_hash != '' OR s1.refund_tx_hash IS NOT NULL AND s1.refund_tx_hash != '')
      AND (s2.redeem_tx_hash IS NOT NULL AND s2.redeem_tx_hash != '' OR s2.refund_tx_hash IS NOT NULL AND s2.refund_tx_hash != '')
  `;

  try {
    // Check if order_analysis is already populated
    const countResult = await analysisPool.query('SELECT COUNT(*) FROM order_analysis');
    const rowCount = parseInt(countResult.rows[0].count, 10);
    if (rowCount > 0) {
      console.log('order_analysis table already populated, skipping population');
      return;
    }

    // Set UTC time zone for stage_db query
    await stagePool.query("SET TIME ZONE 'UTC'");

    // Query stage_db for all completed orders
    const result = await stagePool.query(query);
    console.log(`Retrieved ${result.rowCount} completed orders from stage_db`);

    // Start a transaction
    await analysisPool.query('BEGIN');

    // Insert results into garden_interchain_analysis.order_analysis
    for (const row of result.rows) {
      await analysisPool.query(
        `
        INSERT INTO order_analysis (
          create_order_id, source_swap_id, destination_swap_id, created_at,
          source_chain, destination_chain,
          user_init, cobi_init, user_redeem, cobi_redeem, user_refund, cobi_refund,
          secret_hash,
          user_init_block_number, user_redeem_block_number, user_refund_block_number,
          cobi_init_block_number, cobi_redeem_block_number, cobi_refund_block_number
        )
        VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        `,
        [
          row.create_order_id,
          row.source_swap_id,
          row.destination_swap_id,
          row.created_at, // TIMESTAMPTZ, UTC
          row.source_chain, // TEXT
          row.destination_chain, // TEXT
          row.source_redeem_tx_hash ? row.source_updated_at : null, // TIMESTAMPTZ, UTC
          row.destination_redeem_tx_hash ? row.destination_updated_at : null, // TIMESTAMPTZ, UTC
          row.source_refund_tx_hash ? row.source_updated_at : null, // TIMESTAMPTZ, UTC
          row.destination_refund_tx_hash ? row.destination_updated_at : null, // TIMESTAMPTZ, UTC
          row.secret_hash, // TEXT
          row.source_init_block_number, // BIGINT
          row.source_redeem_tx_hash ? row.source_redeem_block_number : null, // BIGINT
          row.source_refund_tx_hash ? row.source_refund_block_number : null, // BIGINT
          row.destination_init_block_number, // BIGINT
          row.destination_redeem_tx_hash ? row.destination_redeem_block_number : null, // BIGINT
          row.destination_refund_tx_hash ? row.destination_refund_block_number : null, // BIGINT
        ]
      );
    }

    // Commit the transaction
    await analysisPool.query('COMMIT');
    console.log('All completed orders stored in order_analysis');
  } catch (err) {
    await analysisPool.query('ROLLBACK');
    console.error('Error populating order_analysis:', err);
  }
};

// Run table initialization and population on startup
initTable().then(() => populateOrderAnalysis());

// Define the request body interface
interface OrderRequestBody {
  source_chain: string;
  destination_chain: string;
  start_time: string;
  end_time: string;
}

// Define the handler function to query order_analysis
const getOrders = async (req: Request<{}, {}, OrderRequestBody>, res: Response, next: NextFunction): Promise<void> => {
  const { source_chain, destination_chain, start_time, end_time } = req.body;

  if (!source_chain || !destination_chain || !start_time || !end_time) {
    console.error('Missing required fields:', { source_chain, destination_chain, start_time, end_time });
    res.status(400).json({ error: 'All fields are required' });
    return;
  }

  const query = `
    SELECT *
    FROM order_analysis
    WHERE source_chain = $1
      AND destination_chain = $2
      AND created_at BETWEEN $3 AND $4
  `;

  try {
    // Query order_analysis with frontend filters
    const result = await analysisPool.query(query, [source_chain, destination_chain, start_time, end_time]);
    console.log(`Retrieved ${result.rowCount} records from order_analysis`);

    res.json({ message: `Retrieved ${result.rowCount} records`, data: result.rows });
  } catch (err) {
    console.error('Error querying order_analysis:', err);
    res.status(500).json({ error: 'Database query failed' });
  }
};

// Register the route
app.post('/api/orders', getOrders);

// Use port from .env or default to 3000
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});