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
      create_order_id TEXT NOT NULL UNIQUE,
      source_swap_id TEXT NOT NULL,
      destination_swap_id TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL,
      source_chain TEXT NOT NULL,
      destination_chain TEXT NOT NULL,
      user_init TIMESTAMP WITH TIME ZONE,
      cobi_init TIMESTAMP WITH TIME ZONE,
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
    console.log('order_analysis table ensured with TIMESTAMPTZ columns, secret_hash, block numbers, and chain columns');
  } catch (err) {
    console.error('Failed to ensure order_analysis table:', err);
  }
};


// Populate order_analysis with new completed orders from stage_db
const populateOrderAnalysis = async () => {
  try {
    // Get the last synced timestamp from order_analysis
    const lastSyncResult = await analysisPool.query('SELECT MAX(created_at) as last_synced FROM order_analysis');
    const lastSynced = lastSyncResult.rows[0].last_synced || '1970-01-01';

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
        AND co.created_at > $1
    `;

    // Set UTC time zone for stage_db query
    await stagePool.query("SET TIME ZONE 'UTC'");

    // Query stage_db for new completed orders
    const result = await stagePool.query(query, [lastSynced]);
    console.log(`Retrieved ${result.rowCount} new completed orders from stage_db`);

    if (result.rowCount === 0) return;

    // Start a transaction
    await analysisPool.query('BEGIN');

    // Insert new results into garden_interchain_analysis.order_analysis
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
        ON CONFLICT (create_order_id) DO NOTHING
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
    console.log(`Inserted ${result.rowCount} new orders into order_analysis`);
  } catch (err) {
    await analysisPool.query('ROLLBACK');
    console.error('Error populating order_analysis:', err);
  }
};

// Run table initialization and initial population on startup
initTable().then(() => populateOrderAnalysis());

// Periodically sync new orders every 5 minutes (300,000 ms)
setInterval(populateOrderAnalysis, 300000);

// Define the request body interface
interface OrderRequestBody {
  source_chain: string;
  destination_chain: string;
  start_time: string;
  end_time: string;
}

// Define the handler function to calculate average timings
const getOrders = async (req: Request<{}, {}, OrderRequestBody>, res: Response, next: NextFunction): Promise<void> => {
  const { source_chain, destination_chain, start_time, end_time } = req.body;

  if (!source_chain || !destination_chain || !start_time || !end_time) {
    console.error('Missing required fields:', { source_chain, destination_chain, start_time, end_time });
    res.status(400).json({ error: 'All fields are required' });
    return;
  }

  const query = `
    SELECT
      AVG(EXTRACT(EPOCH FROM user_init)) AS avg_user_init,
      AVG(EXTRACT(EPOCH FROM cobi_init)) AS avg_cobi_init,
      AVG(EXTRACT(EPOCH FROM user_redeem)) AS avg_user_redeem,
      AVG(EXTRACT(EPOCH FROM user_refund)) AS avg_user_refund,
      AVG(EXTRACT(EPOCH FROM cobi_redeem)) AS avg_cobi_redeem,
      AVG(EXTRACT(EPOCH FROM cobi_refund)) AS avg_cobi_refund,
      AVG((
        COALESCE(EXTRACT(EPOCH FROM user_init), 0) +
        COALESCE(EXTRACT(EPOCH FROM cobi_init), 0) +
        COALESCE(EXTRACT(EPOCH FROM user_redeem), 0) +
        COALESCE(EXTRACT(EPOCH FROM user_refund), 0) +
        COALESCE(EXTRACT(EPOCH FROM cobi_redeem), 0) +
        COALESCE(EXTRACT(EPOCH FROM cobi_refund), 0)
      ) / (
        (CASE WHEN user_init IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN cobi_init IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN user_redeem IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN user_refund IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN cobi_redeem IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN cobi_refund IS NOT NULL THEN 1 ELSE 0 END)
      )) AS overall_avg
    FROM order_analysis
    WHERE source_chain = $1
      AND destination_chain = $2
      AND created_at BETWEEN $3 AND $4
      AND (
        (CASE WHEN user_init IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN cobi_init IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN user_redeem IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN user_refund IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN cobi_redeem IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN cobi_refund IS NOT NULL THEN 1 ELSE 0 END)
      ) > 0
  `;

  try {
    const result = await analysisPool.query(query, [source_chain, destination_chain, start_time, end_time]);
    const averages = result.rows[0];

    if (!averages.avg_user_init && !averages.avg_cobi_init && !averages.avg_user_redeem &&
        !averages.avg_user_refund && !averages.avg_cobi_redeem && !averages.avg_cobi_refund) {
      res.status(404).json({ error: 'No records found with timestamps in the given range' });
      return;
    }

    res.json({
      message: 'Average timings calculated (in seconds)',
      averages: {
        avg_user_init: averages.avg_user_init ? parseFloat(averages.avg_user_init) : null,
        avg_cobi_init: averages.avg_cobi_init ? parseFloat(averages.avg_cobi_init) : null,
        avg_user_redeem: averages.avg_user_redeem ? parseFloat(averages.avg_user_redeem) : null,
        avg_user_refund: averages.avg_user_refund ? parseFloat(averages.avg_user_refund) : null,
        avg_cobi_redeem: averages.avg_cobi_redeem ? parseFloat(averages.avg_cobi_redeem) : null,
        avg_cobi_refund: averages.avg_cobi_refund ? parseFloat(averages.avg_cobi_refund) : null,
        overall_avg: averages.overall_avg ? parseFloat(averages.overall_avg) : null,
      },
    });
  } catch (err) {
    console.error('Error calculating averages:', err);
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