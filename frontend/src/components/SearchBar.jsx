import { useState } from 'react';
import './SearchBar.css';

export default function SearchBar({ placeholder = 'Filter workspace tasks...', onSearch, className = '' }) {
  const [query, setQuery] = useState('');

  const handleChange = (e) => {
    const value = e.target.value;
    setQuery(value);
    if (onSearch) {
      onSearch(value);
    }
  };

  const clearSearch = () => {
    setQuery('');
    if (onSearch) {
      onSearch('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && onSearch) {
      onSearch(query);
    }
  };

  return (
    <div className={`search-bar ${className}`.trim()}>
      <input
        type="text"
        className="search-input"
        placeholder={placeholder}
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        aria-label="Search tasks"
      />
      {query && (
        <button
          type="button"
          className="clear-button"
          onClick={clearSearch}
          aria-label="Clear search query"
        >
          ✕
        </button>
      )}
    </div>
  );
}
