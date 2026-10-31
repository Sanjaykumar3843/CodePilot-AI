import { useState, useEffect } from 'react';

export default function ProjectTreeModal({ isOpen, onClose, apiUrl, onSelectContextFile }) {
  const [tree, setTree] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [isLoadingContent, setIsLoadingContent] = useState(false);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    let active = true;
    async function loadTree() {
      setIsLoading(true);
      setError('');
      try {
        const res = await fetch(`${apiUrl}/api/files/tree`, { credentials: 'include' });
        const data = await res.json();
        if (active) {
          if (data.success && Array.isArray(data.tree)) {
            setTree(data.tree);
          } else {
            setError('Could not load project structure.');
          }
        }
      } catch (err) {
        if (active) setError(err.message || 'Failed to fetch project tree.');
      } finally {
        if (active) setIsLoading(false);
      }
    }

    loadTree();
    return () => { active = false; };
  }, [isOpen, apiUrl]);

  async function handleOpenFile(filePath) {
    setSelectedFile(filePath);
    setIsLoadingContent(true);
    try {
      const res = await fetch(`${apiUrl}/api/files/read?path=${encodeURIComponent(filePath)}`, {
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success && data.file) {
        setFileContent(data.file.content);
      } else {
        setFileContent(`// Error reading file: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      setFileContent(`// Network error loading file: ${err.message}`);
    } finally {
      setIsLoadingContent(false);
    }
  }

  if (!isOpen) return null;

  function renderTreeNodes(nodes) {
    return (
      <ul className="tree-list">
        {nodes.map((node) => (
          <li key={node.path} className="tree-node">
            {node.type === 'directory' ? (
              <div className="tree-dir">
                <span className="tree-dir-icon">📁</span>
                <span className="tree-dir-name">{node.name}</span>
                {node.children && node.children.length > 0 && renderTreeNodes(node.children)}
              </div>
            ) : (
              <button
                type="button"
                className={`tree-file-btn ${selectedFile === node.path ? 'active' : ''}`}
                onClick={() => handleOpenFile(node.path)}
              >
                <span className="tree-file-icon">📄</span>
                <span className="tree-file-name">{node.name}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="tree-modal-title">
      <div className="tree-modal-card">
        <div className="tree-modal-header">
          <div>
            <h2 id="tree-modal-title" className="tree-modal-title">Project File Explorer</h2>
            <p className="tree-modal-subtitle">Inspect source files in the configured project root.</p>
          </div>
          <button type="button" className="modal-close-button" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>

        <div className="tree-modal-body">
          <div className="tree-sidebar-panel">
            {isLoading ? (
              <p className="tree-loading-text">Loading project tree...</p>
            ) : error ? (
              <p className="tree-error-text">{error}</p>
            ) : (
              renderTreeNodes(tree)
            )}
          </div>

          <div className="tree-content-panel">
            {selectedFile ? (
              <>
                <div className="tree-content-header">
                  <strong>{selectedFile}</strong>
                  {onSelectContextFile && (
                    <button
                      type="button"
                      className="tree-context-btn"
                      onClick={() => {
                        onSelectContextFile(selectedFile);
                        onClose();
                      }}
                    >
                      <span>＋</span> Add to AI Context
                    </button>
                  )}
                </div>
                <div className="tree-code-area">
                  {isLoadingContent ? (
                    <p className="tree-loading-text">Loading file content...</p>
                  ) : (
                    <pre><code>{fileContent}</code></pre>
                  )}
                </div>
              </>
            ) : (
              <div className="tree-placeholder">
                <p>Select a file from the list to view its contents.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

