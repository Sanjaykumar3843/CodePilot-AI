import { useState } from 'react';

/**
 * Parses a raw unified diff patch string into lines with type classification.
 */
function parsePatch(patch) {
  if (!patch) return [];
  const rawLines = patch.split('\n');
  let oldLine = 0;
  let newLine = 0;
  const result = [];

  for (const line of rawLines) {
    if (line.startsWith('---') || line.startsWith('+++')) {
      continue; // Skip header lines
    }

    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      result.push({ type: 'header', content: line, oldNum: '', newNum: '' });
      continue;
    }

    if (line.startsWith('+')) {
      result.push({
        type: 'add',
        content: line.substring(1),
        oldNum: '',
        newNum: newLine++,
      });
    } else if (line.startsWith('-')) {
      result.push({
        type: 'del',
        content: line.substring(1),
        oldNum: oldLine++,
        newNum: '',
      });
    } else {
      result.push({
        type: 'context',
        content: line.startsWith(' ') ? line.substring(1) : line,
        oldNum: oldLine++,
        newNum: newLine++,
      });
    }
  }

  return result;
}

export default function DiffViewer({ files = [], onApplyFile, onOpenFile, isApplying = false }) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  if (!files || files.length === 0) {
    return (
      <div className="diff-empty-state">
        <p>No proposed code changes to review.</p>
      </div>
    );
  }

  const currentFile = files[selectedIndex] || files[0];
  const parsedLines = parsePatch(currentFile.patch);

  return (
    <div className="diff-viewer-container" aria-label="Review proposed code diffs">
      <div className="diff-file-tabs" role="tablist">
        {files.map((file, idx) => (
          <button
            key={file.path || idx}
            type="button"
            role="tab"
            aria-selected={idx === selectedIndex}
            className={`diff-file-tab ${idx === selectedIndex ? 'active' : ''}`}
            onClick={() => setSelectedIndex(idx)}
          >
            <span className={`file-action-badge ${file.action || (file.isNew ? 'create' : 'modify')}`}>
              {file.action ? file.action.toUpperCase() : file.isNew ? 'CREATE' : 'MODIFY'}
            </span>
            <span className="file-tab-path">{file.path}</span>
          </button>
        ))}
      </div>

      <div className="diff-file-header">
        <div className="file-info">
          <strong className="file-name">{currentFile.path}</strong>
          <span className="file-status-indicator">
            {currentFile.isApplied ? '✓ Applied to workspace' : 'Pending review'}
          </span>
        </div>

        <div className="file-actions">
          {onOpenFile && (
            <button
              type="button"
              className="diff-secondary-btn"
              onClick={() => onOpenFile(currentFile.path)}
              title="Reveal file in connected editor"
            >
              <span>⌘</span> Reveal in Editor
            </button>
          )}

          {onApplyFile && !currentFile.isApplied && (
            <button
              type="button"
              className="diff-primary-btn"
              onClick={() => onApplyFile(currentFile)}
              disabled={isApplying}
            >
              {isApplying ? 'Applying changes...' : 'Apply Change'} <span>✓</span>
            </button>
          )}

          {currentFile.isApplied && (
            <span className="diff-applied-badge">Changes Applied</span>
          )}
        </div>
      </div>

      <div className="diff-code-wrapper" tabIndex={0} aria-label={`Unified diff for ${currentFile.path}`}>
        <div className="diff-table">
          {parsedLines.map((line, lineIdx) => {
            if (line.type === 'header') {
              return (
                <div key={lineIdx} className="diff-row diff-row-header">
                  <div className="diff-num-col" />
                  <div className="diff-num-col" />
                  <div className="diff-content-col">{line.content}</div>
                </div>
              );
            }

            return (
              <div key={lineIdx} className={`diff-row diff-row-${line.type}`}>
                <div className="diff-num-col old-num">{line.oldNum}</div>
                <div className="diff-num-col new-num">{line.newNum}</div>
                <div className="diff-marker-col">
                  {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                </div>
                <div className="diff-content-col">
                  <code>{line.content}</code>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

