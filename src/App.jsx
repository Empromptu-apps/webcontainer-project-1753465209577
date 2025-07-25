import React, { useState, useEffect } from 'react';

const OKRTracker = () => {
  const [currentStep, setCurrentStep] = useState(1);
  const [initiatives, setInitiatives] = useState([]);
  const [selectedInitiative, setSelectedInitiative] = useState(null);
  const [loading, setLoading] = useState(false);
  const [csvFile, setCsvFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [apiLogs, setApiLogs] = useState([]);
  const [showApiLogs, setShowApiLogs] = useState(false);
  const [createdObjects, setCreatedObjects] = useState([]);
  const [extractionStatus, setExtractionStatus] = useState('');

  const API_BASE = 'https://builder.empromptu.ai/api_tools';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer 22c3d153c7f536d80c3c384fb6ddc93c',
    'X-Generated-App-ID': '9c61d473-c509-4667-a3df-98736685c3cf',
    'X-Usage-Key': '369397c6ffb66469db3dc7796c8f70f9'
  };

  const logApiCall = (endpoint, method, payload, response) => {
    const log = {
      timestamp: new Date().toISOString(),
      endpoint,
      method,
      payload,
      response,
      id: Date.now()
    };
    setApiLogs(prev => [log, ...prev]);
  };

  const getProgressFromStatus = (status) => {
    const statusMap = {
      'not started': 0,
      'in progress': 50,
      'at risk': 35,
      'blocked': 25,
      'completed': 100
    };
    return statusMap[status?.toLowerCase()] || 0;
  };

  const getStatusColor = (status) => {
    const colorMap = {
      'not started': 'bg-gray-500',
      'in progress': 'bg-blue-500',
      'at risk': 'bg-yellow-500',
      'blocked': 'bg-red-500',
      'completed': 'bg-green-500'
    };
    return colorMap[status?.toLowerCase()] || 'bg-gray-500';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type === 'text/csv') {
      setCsvFile(files[0]);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'text/csv') {
      setCsvFile(file);
    }
  };

  const handleFileUpload = async () => {
    if (!csvFile) return;
    
    setLoading(true);
    setCurrentStep(2);
    setExtractionStatus('Reading CSV file...');
    
    try {
      const fileContent = await csvFile.text();
      
      setExtractionStatus('Ingesting data...');
      
      // Step 1: Ingest CSV data
      const ingestPayload = {
        created_object_name: 'raw_initiatives',
        data_type: 'strings',
        input_data: [fileContent]
      };
      
      const ingestResponse = await fetch(`${API_BASE}/input_data`, {
        method: 'POST',
        headers,
        body: JSON.stringify(ingestPayload)
      });
      
      const ingestResult = await ingestResponse.json();
      logApiCall('/input_data', 'POST', ingestPayload, ingestResult);
      setCreatedObjects(prev => [...prev, 'raw_initiatives']);

      setExtractionStatus('Processing initiatives...');

      // Step 2: Process CSV into structured initiative data
      const processPayload = {
        created_object_names: ['processed_initiatives'],
        prompt_string: `Parse this CSV data into a JSON array of initiative objects. Each object should have: initiative_id, name, owner, status (must be one of: "not started", "in progress", "at risk", "blocked", "completed"), due_date (MM/DD/YYYY format), description, related_okr, objectives, metrics_kpis, notes. Calculate progress_percentage based on status: not started=0%, in progress=50%, at risk=35%, blocked=25%, completed=100%. Return only valid JSON array format: {raw_initiatives}`,
        inputs: [{
          input_object_name: 'raw_initiatives',
          mode: 'combine_events'
        }]
      };

      const processResponse = await fetch(`${API_BASE}/apply_prompt`, {
        method: 'POST',
        headers,
        body: JSON.stringify(processPayload)
      });

      const processResult = await processResponse.json();
      logApiCall('/apply_prompt', 'POST', processPayload, processResult);
      setCreatedObjects(prev => [...prev, 'processed_initiatives']);

      setExtractionStatus('Retrieving processed data...');

      // Step 3: Get processed data
      const retrievePayload = {
        object_name: 'processed_initiatives',
        return_type: 'json'
      };
      
      const retrieveResponse = await fetch(`${API_BASE}/return_data`, {
        method: 'POST',
        headers,
        body: JSON.stringify(retrievePayload)
      });

      const result = await retrieveResponse.json();
      logApiCall('/return_data', 'POST', retrievePayload, result);
      
      let parsedData = [];
      try {
        if (typeof result.value === 'string') {
          parsedData = JSON.parse(result.value);
        } else if (Array.isArray(result.value)) {
          parsedData = result.value;
        }
      } catch (parseError) {
        console.error('JSON parse error:', parseError);
        // Fallback: try to extract JSON from string
        const jsonMatch = result.value?.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          parsedData = JSON.parse(jsonMatch[0]);
        }
      }
      
      setInitiatives(parsedData || []);
      setCurrentStep(3);
      
    } catch (error) {
      console.error('Error processing CSV:', error);
      setExtractionStatus('Error processing file. Please try again.');
    }
    setLoading(false);
  };

  const downloadCSV = () => {
    const csvContent = [
      ['Initiative ID', 'Name', 'Owner', 'Status', 'Progress %', 'Due Date', 'Related OKR', 'Description'].join(','),
      ...initiatives.map(init => [
        init.initiative_id,
        `"${init.name}"`,
        init.owner,
        init.status,
        getProgressFromStatus(init.status),
        init.due_date,
        `"${init.related_okr}"`,
        `"${init.description}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'okr_initiatives.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const deleteAllObjects = async () => {
    for (const objectName of createdObjects) {
      try {
        const response = await fetch(`${API_BASE}/objects/${objectName}`, {
          method: 'DELETE',
          headers
        });
        logApiCall(`/objects/${objectName}`, 'DELETE', null, await response.text());
      } catch (error) {
        console.error(`Error deleting ${objectName}:`, error);
      }
    }
    setCreatedObjects([]);
    setInitiatives([]);
    setCurrentStep(1);
    setCsvFile(null);
  };

  const formatDate = (dateStr) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString();
    } catch {
      return dateStr;
    }
  };

  const isOverdue = (dueDate) => {
    try {
      const due = new Date(dueDate);
      const today = new Date();
      return due < today;
    } catch {
      return false;
    }
  };

  const toggleDarkMode = () => {
    setDarkMode(!darkMode);
    document.documentElement.classList.toggle('dark');
  };

  return (
    <div className={`min-h-screen transition-colors duration-200 ${darkMode ? 'dark bg-gray-900' : 'bg-gray-50'}`}>
      <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <h1 className={`text-3xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            OKR Initiative Tracker
          </h1>
          <div className="flex gap-2">
            <button
              onClick={toggleDarkMode}
              className={`px-4 py-2 rounded-2xl transition-colors ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-gray-700'} shadow-lg`}
              aria-label="Toggle dark mode"
            >
              {darkMode ? '☀️' : '🌙'}
            </button>
            <button
              onClick={() => setShowApiLogs(!showApiLogs)}
              className="px-4 py-2 bg-green-500 text-white rounded-2xl shadow-lg hover:bg-green-600 transition-colors"
              aria-label="Show API logs"
            >
              API Logs
            </button>
            {createdObjects.length > 0 && (
              <button
                onClick={deleteAllObjects}
                className="px-4 py-2 bg-red-500 text-white rounded-2xl shadow-lg hover:bg-red-600 transition-colors"
                aria-label="Delete all data objects"
              >
                Clear Data
              </button>
            )}
          </div>
        </div>

        {/* API Logs Modal */}
        {showApiLogs && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className={`max-w-4xl w-full mx-4 max-h-[80vh] overflow-auto rounded-2xl shadow-2xl ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
              <div className="p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>API Call Logs</h2>
                  <button
                    onClick={() => setShowApiLogs(false)}
                    className={`px-4 py-2 rounded-xl ${darkMode ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-700'}`}
                  >
                    Close
                  </button>
                </div>
                <div className="space-y-4">
                  {apiLogs.map(log => (
                    <div key={log.id} className={`p-4 rounded-xl ${darkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
                      <div className="flex justify-between items-center mb-2">
                        <span className={`font-mono text-sm ${darkMode ? 'text-green-400' : 'text-green-600'}`}>
                          {log.method} {log.endpoint}
                        </span>
                        <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <details className="mt-2">
                        <summary className={`cursor-pointer ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                          View Details
                        </summary>
                        <pre className={`mt-2 p-2 rounded text-xs overflow-auto ${darkMode ? 'bg-gray-800 text-gray-300' : 'bg-white text-gray-700'}`}>
                          {JSON.stringify({ payload: log.payload, response: log.response }, null, 2)}
                        </pre>
                      </details>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 1: File Upload */}
        {currentStep === 1 && (
          <div className={`rounded-2xl shadow-2xl p-8 ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <div className="text-center mb-6">
              <h2 className={`text-2xl font-semibold mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Upload Initiative Data
              </h2>
              <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                Upload your CSV file containing initiative data to get started
              </p>
            </div>

            <div
              className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-200 ${
                dragOver 
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' 
                  : darkMode 
                    ? 'border-gray-600 bg-gray-700' 
                    : 'border-gray-300 bg-gray-50'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="mb-4">
                <svg className={`mx-auto h-12 w-12 ${darkMode ? 'text-gray-400' : 'text-gray-400'}`} stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true">
                  <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="mb-4">
                <p className={`text-lg ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {csvFile ? csvFile.name : 'Drag and drop your CSV file here'}
                </p>
                <p className={`text-sm mt-2 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  or click to browse files
                </p>
              </div>
              <input
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                className="hidden"
                id="file-upload"
                aria-label="Upload CSV file"
              />
              <label
                htmlFor="file-upload"
                className="inline-flex items-center px-6 py-3 bg-primary-600 text-white rounded-2xl hover:bg-primary-700 transition-colors cursor-pointer shadow-lg"
              >
                Choose File
              </label>
            </div>

            {csvFile && (
              <div className="mt-6 text-center">
                <button
                  onClick={handleFileUpload}
                  className="px-8 py-3 bg-primary-600 text-white rounded-2xl hover:bg-primary-700 transition-colors shadow-lg font-semibold"
                  aria-label="Process uploaded file"
                >
                  Process File
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Extraction Progress */}
        {currentStep === 2 && (
          <div className={`rounded-2xl shadow-2xl p-8 text-center ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <div className="mb-6">
              <div className="spinner mx-auto mb-4"></div>
              <h2 className={`text-2xl font-semibold mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Processing Your Data
              </h2>
              <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {extractionStatus}
              </p>
            </div>
            <button
              onClick={() => {
                setLoading(false);
                setCurrentStep(1);
                setCsvFile(null);
              }}
              className={`px-6 py-2 rounded-2xl transition-colors ${darkMode ? 'bg-gray-700 text-white hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              aria-label="Cancel processing"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Step 3: Data Output Table */}
        {currentStep === 3 && !selectedInitiative && (
          <div className={`rounded-2xl shadow-2xl overflow-hidden ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex justify-between items-center">
                <h2 className={`text-2xl font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Initiative Dashboard
                </h2>
                <div className="flex gap-3">
                  <button
                    onClick={downloadCSV}
                    className="px-4 py-2 bg-green-500 text-white rounded-2xl hover:bg-green-600 transition-colors shadow-lg"
                    aria-label="Download CSV"
                  >
                    Download CSV
                  </button>
                  <button
                    onClick={() => setCurrentStep(1)}
                    className="px-4 py-2 bg-primary-600 text-white rounded-2xl hover:bg-primary-700 transition-colors shadow-lg"
                    aria-label="Upload new file"
                  >
                    Upload New File
                  </button>
                </div>
              </div>
            </div>

            {/* Summary Stats */}
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {['not started', 'in progress', 'at risk', 'blocked', 'completed'].map(status => {
                  const count = initiatives.filter(i => i.status?.toLowerCase() === status).length;
                  return (
                    <div key={status} className={`p-4 rounded-2xl ${darkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
                      <div className={`text-2xl font-bold ${getStatusColor(status).replace('bg-', 'text-')}`}>
                        {count}
                      </div>
                      <div className={`text-sm capitalize ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                        {status.replace('_', ' ')}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Bootstrap Table */}
            <div className="overflow-x-auto">
              <table className={`table table-hover ${darkMode ? 'table-dark' : ''}`}>
                <thead className={darkMode ? 'table-dark' : 'table-light'}>
                  <tr>
                    <th scope="col" className="sortable">Initiative</th>
                    <th scope="col" className="sortable">Owner</th>
                    <th scope="col" className="sortable">Status</th>
                    <th scope="col" className="sortable">Progress</th>
                    <th scope="col" className="sortable">Due Date</th>
                    <th scope="col" className="sortable">Related OKR</th>
                  </tr>
                </thead>
                <tbody>
                  {initiatives.map((initiative, index) => (
                    <tr 
                      key={index}
                      onClick={() => setSelectedInitiative(initiative)}
                      className="cursor-pointer"
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          setSelectedInitiative(initiative);
                        }
                      }}
                      aria-label={`View details for ${initiative.name}`}
                    >
                      <td>
                        <div>
                          <div className="fw-bold">{initiative.name}</div>
                          <small className="text-muted">{initiative.initiative_id}</small>
                          <div className="small mt-1">{initiative.description}</div>
                        </div>
                      </td>
                      <td>{initiative.owner}</td>
                      <td>
                        <span className={`badge ${getStatusColor(initiative.status)} text-white`}>
                          {initiative.status}
                        </span>
                      </td>
                      <td>
                        <div className="d-flex align-items-center">
                          <div className="progress me-2" style={{width: '100px', height: '8px'}}>
                            <div 
                              className={`progress-bar ${getStatusColor(initiative.status)}`}
                              style={{width: `${getProgressFromStatus(initiative.status)}%`}}
                              role="progressbar"
                              aria-valuenow={getProgressFromStatus(initiative.status)}
                              aria-valuemin="0"
                              aria-valuemax="100"
                            ></div>
                          </div>
                          <small>{getProgressFromStatus(initiative.status)}%</small>
                        </div>
                      </td>
                      <td>
                        <span className={isOverdue(initiative.due_date) ? 'text-danger fw-bold' : ''}>
                          {formatDate(initiative.due_date)}
                          {isOverdue(initiative.due_date) && ' ⚠️'}
                        </span>
                      </td>
                      <td>{initiative.related_okr}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Detail View */}
        {selectedInitiative && (
          <div className={`rounded-2xl shadow-2xl p-8 ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className={`text-3xl font-bold mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  {selectedInitiative.name}
                </h2>
                <p className={`${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  {selectedInitiative.initiative_id}
                </p>
              </div>
              <button
                onClick={() => setSelectedInitiative(null)}
                className={`px-6 py-3 rounded-2xl transition-colors shadow-lg ${darkMode ? 'bg-gray-700 text-white hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                aria-label="Back to dashboard"
              >
                ← Back to Dashboard
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div>
                <h3 className={`text-xl font-semibold mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Initiative Details
                </h3>
                <div className="space-y-4">
                  <div>
                    <strong className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Owner:</strong>
                    <span className={`ml-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {selectedInitiative.owner}
                    </span>
                  </div>
                  <div>
                    <strong className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Status:</strong>
                    <span className={`ml-2 inline-flex px-3 py-1 text-sm font-semibold rounded-full text-white ${getStatusColor(selectedInitiative.status)}`}>
                      {selectedInitiative.status}
                    </span>
                  </div>
                  <div>
                    <strong className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Progress:</strong>
                    <span className={`ml-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {getProgressFromStatus(selectedInitiative.status)}%
                    </span>
                  </div>
                  <div>
                    <strong className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Due Date:</strong>
                    <span className={`ml-2 ${isOverdue(selectedInitiative.due_date) ? 'text-red-500 font-semibold' : darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {formatDate(selectedInitiative.due_date)}
                      {isOverdue(selectedInitiative.due_date) && ' ⚠️ OVERDUE'}
                    </span>
                  </div>
                  <div>
                    <strong className={darkMode ? 'text-gray-300' : 'text-gray-700'}>Related OKR:</strong>
                    <span className={`ml-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {selectedInitiative.related_okr}
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <h3 className={`text-xl font-semibold mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Description
                </h3>
                <div className={`p-4 rounded-2xl ${darkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
                  <p className={darkMode ? 'text-gray-300' : 'text-gray-700'}>
                    {selectedInitiative.description}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div>
                <h3 className={`text-xl font-semibold mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Original Objectives
                </h3>
                <div className={`p-4 rounded-2xl ${darkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
                  <p className={darkMode ? 'text-gray-300' : 'text-gray-700'}>
                    {selectedInitiative.objectives || 'No objectives specified'}
                  </p>
                </div>
              </div>

              <div>
                <h3 className={`text-xl font-semibold mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  Metrics/KPIs
                </h3>
                <div className={`p-4 rounded-2xl ${darkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
                  <p className={darkMode ? 'text-gray-300' : 'text-gray-700'}>
                    {selectedInitiative.metrics_kpis || 'No metrics specified'}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-8">
              <h3 className={`text-xl font-semibold mb-4 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Full Notes
              </h3>
              <div className={`p-4 rounded-2xl ${darkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
                <p className={`whitespace-pre-wrap ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {selectedInitiative.notes || 'No additional notes'}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OKRTracker;
