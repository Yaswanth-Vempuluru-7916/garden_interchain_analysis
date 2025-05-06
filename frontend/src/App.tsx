import { useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import './App.css';

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

  const formatDecimal = (value: number | null): string => {
    if (value === null) return 'N/A';
    return `${value.toFixed(2)}s`;
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
    <div className="app-container">
      <div className="app-header">
        <h1 className="app-title">Garden Interchain Analysis</h1>
      </div>

      <div className="form-grid">
        <div className="form-group">
          <label className="form-label">Source Chain:</label>
          <div className="form-select">
            <select value={sourceChain} onChange={(e) => setSourceChain(e.target.value)}>
              {/* <option value="arbitrum_sepolia">Arbitrum Sepolia</option> */}
              <option value="starknet_sepolia">Starknet Sepolia</option>
              <option value="hyperliquid_testnet">Hyperliquid Testnet</option>
              <option value="ethereum_sepolia">Ethereum Sepolia</option>
              <option value="base_sepolia">Base Sepolia</option>
              <option value="monad_testnet">Monad Testnet</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Destination Chain:</label>
          <div className="form-select">
            <select value={destinationChain} onChange={(e) => setDestinationChain(e.target.value)}>
              {/* <option value="arbitrum_sepolia">Arbitrum Sepolia</option> */}
              <option value="starknet_sepolia">Starknet Sepolia</option>
              <option value="hyperliquid_testnet">Hyperliquid Testnet</option>
              <option value="ethereum_sepolia">Ethereum Sepolia</option>
              <option value="base_sepolia">Base Sepolia</option>
              <option value="monad_testnet">Monad Testnet</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Start Date:</label>
          <DatePicker
            selected={startDate}
            onChange={(date: Date | null) => setStartDate(date)}
            dateFormat="yyyy-MM-dd"
            placeholderText="Select start date"
          />
        </div>

        <div className="form-group">
          <label className="form-label">End Date:</label>
          <DatePicker
            selected={endDate}
            onChange={(date: Date | null) => setEndDate(date)}
            dateFormat="yyyy-MM-dd"
            placeholderText="Select end date"
          />
        </div>
      </div>
      
      <button className="submit-button" onClick={handleSubmit}>Calculate Averages</button>
      
      {error && <div className="error-message">{error}</div>}
      {message && <div className="success-message">{message}</div>}
      
      {totalOrders !== null && (
        <div className="total-orders">
          Total Orders in Timeframe: {totalOrders}
        </div>
      )}
      
      {averages && (
        <div className="results-section">
            <div className="stat-card overall-stat-card">
              <div className="stat-label">Overall Duration (from created_at to last event)</div>
              <div className="stat-value overall-value">{formatDecimal(averages.avg_overall_duration)}</div>
            </div>
          <h2 className="results-header">Average Durations</h2>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-label">User Init Duration (from created_at)</div>
              <div className="stat-value">{formatDecimal(averages.avg_user_init_duration)}</div>
            </div>
            
            <div className="stat-card">
              <div className="stat-label">Cobi Init Duration (from user_init)</div>
              <div className="stat-value">{formatDecimal(averages.avg_cobi_init_duration)}</div>
            </div>
            
            <div className="stat-card">
              <div className="stat-label">User Redeem Duration (from user_init)</div>
              <div className="stat-value">{formatDecimal(averages.avg_user_redeem_duration)}</div>
            </div>
            
            <div className="stat-card">
              <div className="stat-label">User Refund Duration (from user_init)</div>
              <div className="stat-value">{formatDecimal(averages.avg_user_refund_duration)}</div>
            </div>
            
            <div className="stat-card">
              <div className="stat-label">Cobi Redeem Duration (from cobi_init)</div>
              <div className="stat-value">{formatDecimal(averages.avg_cobi_redeem_duration)}</div>
            </div>
            
            <div className="stat-card">
              <div className="stat-label">Cobi Refund Duration (from cobi_init)</div>
              <div className="stat-value">{formatDecimal(averages.avg_cobi_refund_duration)}</div>
            </div>
            
          </div>
        </div>
      )}
    </div>
  );
}

export default App;