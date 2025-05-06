import { useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

const App = () => {
  const [sourceChain, setSourceChain] = useState<string>('arbitrum_sepolia');
  const [destinationChain, setDestinationChain] = useState<string>('starknet_sepolia');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalOrders, setTotalOrders] = useState<number | null>(null);
  const [averages, setAverages] = useState<{
    avg_user_init_duration: number | null;
    avg_cobi_init_duration: number | null;
    avg_user_redeem_duration: number | null;
    avg_user_refund_duration: number | null;
    avg_cobi_redeem_duration: number | null;
    avg_cobi_refund_duration: number | null;
    avg_overall_duration: number | null;
  } | null>(null);

  const formatDate = (date: Date | null): string => {
    if (!date) return '';
    return date.toISOString().replace('T', ' ').substring(0, 19) + '+00';
  };

  const handleSubmit = async () => {
    if (!startDate || !endDate) {
      setError('Please select both start and end dates');
      return;
    }

    try {
      const response = await fetch('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_chain: sourceChain,
          destination_chain: destinationChain,
          start_time: formatDate(startDate),
          end_time: formatDate(endDate),
        }),
      });

      const data = await response.json();
      if (response.ok) {
        setMessage(data.message);
        setTotalOrders(data.total_orders);
        setAverages(data.averages);
        setError(null);
      } else {
        setError(data.error || 'Failed to process request');
        setTotalOrders(null);
        setAverages(null);
      }
    } catch (err) {
      setError('Error connecting to backend');
      setTotalOrders(null);
      setAverages(null);
    }
  };

  return (
    <div>
      <h1>Garden Interchain Analysis</h1>
      <div>
        <label>Source Chain:</label>
        <select value={sourceChain} onChange={(e) => setSourceChain(e.target.value)}>
          {/* <option value="arbitrum_sepolia">Arbitrum Sepolia</option> */}
          <option value="starknet_sepolia">Starknet Sepolia</option>
          <option value="hyperliquid_testnet">Hyperliquid Testnet</option>
          <option value="ethereum_sepolia">Ethereum Sepolia</option>
          <option value="base_sepolia">Base Sepolia</option>
          <option value="monad_testnet">Monad Testnet</option>
        </select>
      </div>
      <div>
        <label>Destination Chain:</label>
        <select value={destinationChain} onChange={(e) => setDestinationChain(e.target.value)}>
          {/* <option value="arbitrum_sepolia">Arbitrum Sepolia</option> */}
          <option value="starknet_sepolia">Starknet Sepolia</option>
          <option value="hyperliquid_testnet">Hyperliquid Testnet</option>
          <option value="ethereum_sepolia">Ethereum Sepolia</option>
          <option value="base_sepolia">Base Sepolia</option>
          <option value="monad_testnet">Monad Testnet</option>
        </select>
      </div>
      <div>
        <label>Start Date:</label>
        <DatePicker
          selected={startDate}
          onChange={(date: Date | null) => setStartDate(date)}
          dateFormat="yyyy-MM-dd"
        />
      </div>
      <div>
        <label>End Date:</label>
        <DatePicker
          selected={endDate}
          onChange={(date: Date | null) => setEndDate(date)}
          dateFormat="yyyy-MM-dd"
        />
      </div>
      <button onClick={handleSubmit}>Calculate Averages</button>
      {error && <p>Error: {error}</p>}
      {message && <p>{message}</p>}
      {totalOrders !== null && <p>Total Orders in Timeframe: {totalOrders}</p>}
      {averages && (
        <div>
          <h2>Average Durations (in seconds):</h2>
          <p>Average User Init Duration (from created_at): {averages.avg_user_init_duration ? `${averages.avg_user_init_duration}s` : 'N/A'}</p>
          <p>Average Cobi Init Duration (from user_init): {averages.avg_cobi_init_duration ? `${averages.avg_cobi_init_duration}s` : 'N/A'}</p>
          <p>Average User Redeem Duration (from user_init): {averages.avg_user_redeem_duration ? `${averages.avg_user_redeem_duration}s` : 'N/A'}</p>
          <p>Average User Refund Duration (from user_init): {averages.avg_user_refund_duration ? `${averages.avg_user_refund_duration}s` : 'N/A'}</p>
          <p>Average Cobi Redeem Duration (from cobi_init): {averages.avg_cobi_redeem_duration ? `${averages.avg_cobi_redeem_duration}s` : 'N/A'}</p>
          <p>Average Cobi Refund Duration (from cobi_init): {averages.avg_cobi_refund_duration ? `${averages.avg_cobi_refund_duration}s` : 'N/A'}</p>
          <p>Average Overall Duration (from created_at to last event): {averages.avg_overall_duration ? `${averages.avg_overall_duration}s` : 'N/A'}</p>
        </div>
      )}
    </div>
  );
}

export default App;