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
      user_init TEXT,
      cobi_init TEXT,
      user_redeem TEXT,
      cobi_redeem TEXT,
      user_refund TEXT,
      cobi_refund TEXT
    );
  `;
  try {
    await analysisPool.query(createTableQuery);
    console.log('order_analysis table ready');
  } catch (err) {
    console.error('Failed to create order_analysis table:', err);
  }
};

// Run table initialization on startup
initTable();

// Define the request body interface
interface OrderRequestBody {
  source_chain: string;
  destination_chain: string;
  start_time: string;
  end_time: string;
}

// Define the handler function
const getOrders = async (req: Request<{}, {}, OrderRequestBody>, res: Response, next: NextFunction): Promise<void> => {
  const { source_chain, destination_chain, start_time, end_time } = req.body;

  if (!source_chain || !destination_chain || !start_time || !end_time) {
    console.error('Missing required fields:', { source_chain, destination_chain, start_time, end_time });
    res.status(400).json({ error: 'All fields are required' });
    return;
  }

  const query = `
    SELECT DISTINCT mo.create_order_id, mo.source_swap_id, mo.destination_swap_id, co.created_at
    FROM create_orders co
    INNER JOIN matched_orders mo ON co.create_id = mo.create_order_id
    INNER JOIN swaps s1 ON mo.source_swap_id = s1.swap_id
    INNER JOIN swaps s2 ON mo.destination_swap_id = s2.swap_id
    WHERE co.source_chain = $1
      AND co.destination_chain = $2
      AND co.created_at BETWEEN $3 AND $4
      AND (s1.redeem_tx_hash IS NOT NULL OR s1.refund_tx_hash IS NOT NULL)
      AND (s2.redeem_tx_hash IS NOT NULL OR s2.refund_tx_hash IS NOT NULL);
  `;

  try {
    // Log input parameters
    console.log('Query inputs:', { source_chain, destination_chain, start_time, end_time });

    // Start a transaction
    await analysisPool.query('BEGIN');

    // Delete all existing records from order_analysis
    await analysisPool.query('DELETE FROM order_analysis');
    console.log('Cleared order_analysis table');

    // Reset the id sequence
    await analysisPool.query('ALTER SEQUENCE order_analysis_id_seq RESTART WITH 1');
    console.log('Reset id sequence to 1');

    // Query stage_db
    const result = await stagePool.query(query, [source_chain, destination_chain, start_time, end_time]);
    console.log(`Retrieved ${result.rowCount} records from stage_db`);

    // Insert results into garden_interchain_analysis.order_analysis
    for (const row of result.rows) {
      await analysisPool.query(
        `
        INSERT INTO order_analysis (
          create_order_id, source_swap_id, destination_swap_id, created_at,
          user_init, cobi_init, user_redeem, cobi_redeem, user_refund, cobi_refund
        )
        VALUES ($1, $2, $3, $4, NULL, NULL, NULL, NULL, NULL, NULL)
        `,
        [row.create_order_id, row.source_swap_id, row.destination_swap_id, row.created_at]
      );
      console.log(`Inserted record: ${row.create_order_id}`);
    }

    // Commit the transaction
    await analysisPool.query('COMMIT');
    console.log('Transaction committed');

    res.json({ message: `Successfully stored ${result.rowCount} records in the database` });
  } catch (err) {
    // Rollback transaction on error
    await analysisPool.query('ROLLBACK');
    console.error('Error during database operation:', err);
    res.status(500).json({ error: 'Database operation failed' });
  }
};

// Register the route
app.post('/api/orders', getOrders);

app.listen(3000, () => {
  console.log('Backend running on http://localhost:3000');
});

// import express, { Request, Response, NextFunction } from 'express';
// import { Pool } from 'pg';
// import dotenv from 'dotenv';
// import cors from 'cors';

// dotenv.config();

// const app = express();
// app.use(cors());
// app.use(express.json());

// // Pool for stage_db (source data)
// const stagePool = new Pool({
//   user: process.env.STAGE_DB_USER,
//   host: process.env.STAGE_DB_HOST,
//   database: process.env.STAGE_DB_NAME,
//   password: process.env.STAGE_DB_PASSWORD,
//   port: Number(process.env.STAGE_DB_PORT),
// });

// // Pool for garden_interchain_analysis (storing results)
// const analysisPool = new Pool({
//   user: process.env.ANALYSIS_DB_USER,
//   host: process.env.ANALYSIS_DB_HOST,
//   database: process.env.ANALYSIS_DB_NAME,
//   password: process.env.ANALYSIS_DB_PASSWORD,
//   port: Number(process.env.ANALYSIS_DB_PORT),
// });

// // Initialize order_analysis table
// const initTable = async () => {
//   const createTableQuery = `
//     CREATE TABLE IF NOT EXISTS order_analysis (
//       id SERIAL PRIMARY KEY,
//       create_order_id TEXT NOT NULL,
//       source_swap_id TEXT NOT NULL,
//       destination_swap_id TEXT NOT NULL,
//       created_at TIMESTAMP WITH TIME ZONE NOT NULL,
//       user_init TEXT,
//       cobi_init TEXT,
//       user_redeem TEXT,
//       cobi_redeem TEXT,
//       user_refund TEXT,
//       cobi_refund TEXT
//     );
//   `;
//   try {
//     await analysisPool.query(createTableQuery);
//     console.log('order_analysis table ready');
//   } catch (err) {
//     console.error('Failed to create order_analysis table:', err);
//   }
// };

// // Run table initialization on startup
// initTable();

// // Define the request body interface
// interface OrderRequestBody {
//   source_chain: string;
//   destination_chain: string;
//   start_time: string;
//   end_time: string;
// }

// // Define the handler function
// const getOrders = async (req: Request<{}, {}, OrderRequestBody>, res: Response, next: NextFunction): Promise<void> => {
//   const { source_chain, destination_chain, start_time, end_time } = req.body;

//   if (!source_chain || !destination_chain || !start_time || !end_time) {
//     console.error('Missing required fields:', { source_chain, destination_chain, start_time, end_time });
//     res.status(400).json({ error: 'All fields are required' });
//     return;
//   }

//   const query = `
//     SELECT DISTINCT mo.create_order_id, mo.source_swap_id, mo.destination_swap_id, co.created_at
//     FROM create_orders co
//     INNER JOIN matched_orders mo ON co.create_id = mo.create_order_id
//     INNER JOIN swaps s1 ON mo.source_swap_id = s1.swap_id
//     INNER JOIN swaps s2 ON mo.destination_swap_id = s2.swap_id
//     WHERE co.source_chain = $1
//       AND co.destination_chain = $2
//       AND co.created_at BETWEEN $3 AND $4
//       AND (s1.redeem_tx_hash IS NOT NULL OR s1.refund_tx_hash IS NOT NULL)
//       AND (s2.redeem_tx_hash IS NOT NULL OR s2.refund_tx_hash IS NOT NULL);
//   `;

//   try {
//     // Log input parameters
//     console.log('Query inputs:', { source_chain, destination_chain, start_time, end_time });

//     // Start a transaction
//     await analysisPool.query('BEGIN');

//     // Delete all existing records from order_analysis
//     await analysisPool.query('DELETE FROM order_analysis');
//     console.log('Cleared order_analysis table');

//     // Query stage_db
//     const result = await stagePool.query(query, [source_chain, destination_chain, start_time, end_time]);
//     console.log(`Retrieved ${result.rowCount} records from stage_db`);

//     // Insert results into garden_interchain_analysis.order_analysis
//     for (const row of result.rows) {
//       await analysisPool.query(
//         `
//         INSERT INTO order_analysis (
//           create_order_id, source_swap_id, destination_swap_id, created_at,
//           user_init, cobi_init, user_redeem, cobi_redeem, user_refund, cobi_refund
//         )
//         VALUES ($1, $2, $3, $4, NULL, NULL, NULL, NULL, NULL, NULL)
//         `,
//         [row.create_order_id, row.source_swap_id, row.destination_swap_id, row.created_at]
//       );
//       console.log(`Inserted record: ${row.create_order_id}`);
//     }

//     // Commit the transaction
//     await analysisPool.query('COMMIT');
//     console.log('Transaction committed');

//     res.json({ message: `Successfully stored ${result.rowCount} records in the database` });
//   } catch (err) {
//     // Rollback transaction on error
//     await analysisPool.query('ROLLBACK');
//     console.error('Error during database operation:', err);
//     res.status(500).json({ error: 'Database operation failed' });
//   }
// };

// // Register the route
// app.post('/api/orders', getOrders);

// app.listen(3000, () => {
//   console.log('Backend running on http://localhost:3000');
// });

// import express, { Request, Response, NextFunction } from 'express';
// import { Pool } from 'pg';
// import dotenv from 'dotenv';
// import cors from 'cors';

// dotenv.config();

// const app = express();
// app.use(cors());
// app.use(express.json());

// // Pool for stage_db (source data)
// const stagePool = new Pool({
//   user: process.env.STAGE_DB_USER,
//   host: process.env.STAGE_DB_HOST,
//   database: process.env.STAGE_DB_NAME,
//   password: process.env.STAGE_DB_PASSWORD,
//   port: Number(process.env.STAGE_DB_PORT),
// });

// // Pool for garden_interchain_analysis (storing results)
// const analysisPool = new Pool({
//   user: process.env.ANALYSIS_DB_USER,
//   host: process.env.ANALYSIS_DB_HOST,
//   database: process.env.ANALYSIS_DB_NAME,
//   password: process.env.ANALYSIS_DB_PASSWORD,
//   port: Number(process.env.ANALYSIS_DB_PORT),
// });

// // Initialize order_analysis table
// const initTable = async () => {
//   const createTableQuery = `
//     CREATE TABLE IF NOT EXISTS order_analysis (
//       id SERIAL PRIMARY KEY,
//       create_order_id TEXT NOT NULL,
//       source_swap_id TEXT NOT NULL,
//       destination_swap_id TEXT NOT NULL,
//       created_at TIMESTAMP WITH TIME ZONE NOT NULL,
//       user_init TEXT,
//       cobi_init TEXT,
//       user_redeem TEXT,
//       cobi_redeem TEXT,
//       user_refund TEXT,
//       cobi_refund TEXT
//     );
//   `;
//   try {
//     await analysisPool.query(createTableQuery);
//     console.log('order_analysis table ready');
//   } catch (err) {
//     console.error('Failed to create order_analysis table:', err);
//   }
// };

// // Run table initialization on startup
// initTable();

// // Define the request body interface
// interface OrderRequestBody {
//   source_chain: string;
//   destination_chain: string;
//   start_time: string;
//   end_time: string;
// }

// // Define the handler function
// const getOrders = async (req: Request<{}, {}, OrderRequestBody>, res: Response, next: NextFunction): Promise<void> => {
//   const { source_chain, destination_chain, start_time, end_time } = req.body;

//   if (!source_chain || !destination_chain || !start_time || !end_time) {
//     res.status(400).json({ error: 'All fields are required' });
//     return;
//   }

//   const query = `
//     SELECT DISTINCT mo.create_order_id, mo.source_swap_id, mo.destination_swap_id, co.created_at
//     FROM create_orders co
//     INNER JOIN matched_orders mo ON co.create_id = mo.create_order_id
//     INNER JOIN swaps s1 ON mo.source_swap_id = s1.swap_id
//     INNER JOIN swaps s2 ON mo.destination_swap_id = s2.swap_id
//     WHERE co.source_chain = $1
//       AND co.destination_chain = $2
//       AND co.created_at BETWEEN $3 AND $4
//       AND (s1.redeem_tx_hash IS NOT NULL OR s1.refund_tx_hash IS NOT NULL)
//       AND (s2.redeem_tx_hash IS NOT NULL OR s2.redeem_tx_hash IS NOT NULL);
//   `;

//   try {
//     // Query stage_db
//     const result = await stagePool.query(query, [source_chain, destination_chain, start_time, end_time]);

//     // Insert results into garden_interchain_analysis.order_analysis
//     for (const row of result.rows) {
//       await analysisPool.query(
//         `
//         INSERT INTO order_analysis (
//           create_order_id, source_swap_id, destination_swap_id, created_at,
//           user_init, cobi_init, user_redeem, cobi_redeem, user_refund, cobi_refund
//         )
//         VALUES ($1, $2, $3, $4, NULL, NULL, NULL, NULL, NULL, NULL)
//         `,
//         [row.create_order_id, row.source_swap_id, row.destination_swap_id, row.created_at]
//       );
//     }

//     res.json({ message: `Successfully stored ${result.rowCount} records in the database` });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: 'Database operation failed' });
//   }
// };

// // Register the route
// app.post('/api/orders', getOrders);

// app.listen(3000, () => {
//   console.log('Backend running on http://localhost:3000');
// });