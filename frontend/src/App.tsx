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
        setError(null);
      } else {
        setError(data.error || 'Failed to process request');
      }
    } catch (err) {
      setError('Error connecting to backend');
    }
  };

  return (
    <div>
      <h1>Garden Interchain Analysis</h1>
      <div>
        <label>Source Chain:</label>
        <select value={sourceChain} onChange={(e) => setSourceChain(e.target.value)}>
          <option value="arbitrum_sepolia">Arbitrum Sepolia</option>
          <option value="starknet_sepolia">Starknet Sepolia</option>
          <option value="hyperliquid_testnet">Hyperliquid Testnet</option>
          {/* <option value="bitcoin_testnet">Bitcoin Testnet</option> */}
          <option value="ethereum_sepolia">Ethereum Sepolia</option>
          <option value="base_sepolia">Base Sepolia</option>
          <option value="monad_testnet">Monad Testnet</option>
          {/* <option value="citrea_testnet">Citrea Testnet</option> */}
          {/* <option value="bera_testnet">Bera Testnet</option> */}
        </select>
      </div>
      <div>
        <label>Destination Chain:</label>
        <select value={destinationChain} onChange={(e) => setDestinationChain(e.target.value)}>
          <option value="arbitrum_sepolia">Arbitrum Sepolia</option>
          <option value="starknet_sepolia">Starknet Sepolia</option>
          <option value="hyperliquid_testnet">Hyperliquid Testnet</option>
          {/* <option value="bitcoin_testnet">Bitcoin Testnet</option> */}
          <option value="ethereum_sepolia">Ethereum Sepolia</option>
          <option value="base_sepolia">Base Sepolia</option>
          <option value="monad_testnet">Monad Testnet</option>
          {/* <option value="citrea_testnet">Citrea Testnet</option> */}
          {/* <option value="bera_testnet">Bera Testnet</option> */}
        </select>
      </div>
      <div>
        <label>Start Date:</label>
        <DatePicker
          selected={startDate}
          onChange={(date: Date|null) => setStartDate(date)}
          dateFormat="yyyy-MM-dd"
        />
      </div>
      <div>
        <label>End Date:</label>
        <DatePicker
          selected={endDate}
          onChange={(date: Date |null) => setEndDate(date)}
          dateFormat="yyyy-MM-dd"
          />
      </div>
      <button onClick={handleSubmit}>Store Orders</button>
      {error && <p>Error: {error}</p>}
      {message && <p>{message}</p>}
    </div>
  );
}

export default App