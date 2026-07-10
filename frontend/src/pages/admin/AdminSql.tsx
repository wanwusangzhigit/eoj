import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { t } from '../../i18n';
import {
  Send, Plus, ChevronLeft, ChevronRight,
} from 'lucide-react';
import '../Admin.css';

export default function AdminSql() {
  useDocumentTitle(t('admin.sqlEditor'));
  const [sqlMode, setSqlMode] = useState<'command' | 'visual'>('visual');
  const [sqlQuery, setSqlQuery] = useState('SELECT * FROM users LIMIT 10');
  const [sqlResult, setSqlResult] = useState<any>(null);
  const [sqlError, setSqlError] = useState('');
  const [sqlExecuting, setSqlExecuting] = useState(false);
  const [sqlPassword, setSqlPassword] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [pendingDeleteAction, setPendingDeleteAction] = useState<(() => void) | null>(null);

  // Visual editor state
  const [sqlTables, setSqlTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [tableSchema, setTableSchema] = useState<any[]>([]);
  const [tableData, setTableData] = useState<any[]>([]);
  const [tablePagination, setTablePagination] = useState<any>(null);
  const [tablePage, setTablePage] = useState(1);
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [addingRow, setAddingRow] = useState(false);
  const [newRowData, setNewRowData] = useState<Record<string, any>>({});

  useEffect(() => {
    if (sqlMode === 'visual') {
      fetchSqlTables();
    }
  }, [sqlMode]);

  useEffect(() => {
    if (selectedTable) fetchTableData();
  }, [selectedTable, tablePage]);

  const handleExecuteSql = async () => {
    setSqlExecuting(true);
    setSqlError('');
    setSqlResult(null);
    try {
      const upperQuery = sqlQuery.trim().toUpperCase();
      const needsPassword = upperQuery.startsWith('DELETE');
      const data = await api.executeSql(sqlQuery, needsPassword ? sqlPassword : undefined);
      setSqlResult(data);
      if (needsPassword) setSqlPassword('');
    } catch (e: any) {
      setSqlError(e.message || t('common.error'));
    } finally {
      setSqlExecuting(false);
    }
  };

  const fetchSqlTables = async () => {
    try {
      const data = await api.getSqlTables();
      setSqlTables(data.tables);
      if (data.tables.length > 0 && !selectedTable) {
        setSelectedTable(data.tables[0]);
      }
    } catch (e) { console.error('Failed to fetch tables:', e); }
  };

  const fetchTableData = async () => {
    if (!selectedTable) return;
    try {
      const data = await api.getTableData(selectedTable, { page: tablePage, pageSize: 20 });
      setTableData(data.rows);
      setTablePagination(data.pagination);
      const schemaData = await api.getTableSchema(selectedTable);
      setTableSchema(schemaData.schema);
    } catch (e: any) {
      console.error('Failed to fetch table data:', e);
    }
  };

  const handleCellEdit = (rowIdx: number, col: string, value: any) => {
    setEditingCell({ row: rowIdx, col });
    setEditingValue(value === null ? '' : String(value));
  };

  const handleCellSave = async (rowIdx: number) => {
    if (!selectedTable || !editingCell) return;
    const row = tableData[rowIdx];
    const pkCols = tableSchema.filter((s: any) => s.pk === 1).map((s: any) => s.name);
    const where: Record<string, any> = {};
    for (const pk of pkCols) {
      where[pk] = row[pk];
    }
    if (Object.keys(where).length === 0) {
      for (const s of tableSchema) {
        where[s.name] = row[s.name];
      }
    }
    try {
      await api.updateTableRow(selectedTable, { [editingCell.col]: editingValue }, where);
      setEditingCell(null);
      fetchTableData();
    } catch (e: any) {
      setSqlError(e.message || t('common.error'));
    }
  };

  const handleAddRow = async () => {
    if (!selectedTable) return;
    try {
      await api.insertTableRow(selectedTable, newRowData);
      setAddingRow(false);
      setNewRowData({});
      fetchTableData();
    } catch (e: any) {
      setSqlError(e.message || t('common.error'));
    }
  };

  const handleDeleteRow = (row: any) => {
    const pkCols = tableSchema.filter((s: any) => s.pk === 1).map((s: any) => s.name);
    const where: Record<string, any> = {};
    for (const pk of pkCols) {
      where[pk] = row[pk];
    }
    if (Object.keys(where).length === 0) {
      for (const s of tableSchema) {
        where[s.name] = row[s.name];
      }
    }
    setPendingDeleteAction(() => async () => {
      try {
        await api.deleteTableRow(selectedTable, where, sqlPassword);
        setSqlPassword('');
        setShowPasswordModal(false);
        setPendingDeleteAction(null);
        fetchTableData();
      } catch (e: any) {
        setSqlError(e.message || t('common.error'));
        setShowPasswordModal(false);
      }
    });
    setShowPasswordModal(true);
  };

  const confirmDeleteWithPassword = () => {
    if (pendingDeleteAction) {
      pendingDeleteAction();
    }
  };

  return (
    <div className="admin-form">
      <h2>{t('admin.sqlEditor')}</h2>
      <div className="sql-mode-tabs">
        <button
          className={`sql-mode-btn ${sqlMode === 'visual' ? 'active' : ''}`}
          onClick={() => setSqlMode('visual')}
        >
          {t('admin.visualEditor')}
        </button>
        <button
          className={`sql-mode-btn ${sqlMode === 'command' ? 'active' : ''}`}
          onClick={() => setSqlMode('command')}
        >
          {t('admin.sqlCommand')}
        </button>
      </div>

      {sqlMode === 'command' ? (
        <>
          <p style={{fontSize:'13px',color:'var(--text-secondary)',marginBottom:'12px'}}>
            {t('admin.sqlWarning')}
          </p>
          <div className="form-group">
            <textarea
              className="sql-editor-textarea"
              value={sqlQuery}
              onChange={(e) => setSqlQuery(e.target.value)}
              rows={8}
              placeholder="SELECT * FROM users LIMIT 10"
              spellCheck={false}
            />
          </div>
          {sqlQuery.trim().toUpperCase().startsWith('DELETE') && (
            <div className="form-group">
              <label>{t('admin.deletePassword')}</label>
              <input
                type="password"
                className="form-input"
                value={sqlPassword}
                onChange={(e) => setSqlPassword(e.target.value)}
                placeholder={t('admin.enterPassword')}
              />
            </div>
          )}
          <div className="form-actions">
            <button
              className="btn btn-primary"
              onClick={handleExecuteSql}
              disabled={sqlExecuting || !sqlQuery.trim()}
            >
              <Send size={14} /> {sqlExecuting ? t('common.loading') : t('admin.executeSql')}
            </button>
          </div>
          {sqlError && <div className="message error" style={{marginTop:'12px'}}>{sqlError}</div>}
          {sqlResult && (
            <div className="sql-result-container">
              {sqlResult.results && sqlResult.results.length > 0 ? (
                <div className="sql-result-table-wrapper">
                  <table className="sql-result-table">
                    <thead>
                      <tr>{Object.keys(sqlResult.results[0]).map((key) => <th key={key}>{key}</th>)}</tr>
                    </thead>
                    <tbody>
                      {sqlResult.results.map((row: any, idx: number) => (
                        <tr key={idx}>
                          {Object.values(row).map((val: any, i: number) => (
                            <td key={i}>{val === null ? <em>NULL</em> : String(val)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : sqlResult.meta ? (
                <div className="message success" style={{marginTop:'12px'}}>
                  {t('admin.rowsAffected')}: {sqlResult.meta.changes ?? 0}
                </div>
              ) : (
                <div className="message success" style={{marginTop:'12px'}}>{t('admin.queryExecuted')}</div>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="visual-editor-toolbar">
            <div className="form-group" style={{marginBottom:0}}>
              <select
                className="filter-select"
                value={selectedTable}
                onChange={(e) => { setSelectedTable(e.target.value); setTablePage(1); setAddingRow(false); }}
              >
                <option value="">{t('admin.selectTable')}</option>
                {sqlTables.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            {selectedTable && (
              <button className="btn btn-primary btn-sm" onClick={() => { setAddingRow(true); setNewRowData({}); }}>
                <Plus size={14} /> {t('admin.addRow')}
              </button>
            )}
          </div>

          {sqlError && <div className="message error" style={{marginTop:'12px'}}>{sqlError}</div>}

          {selectedTable && tableData.length >= 0 && tableSchema.length > 0 && (
            <div className="sql-visual-table-wrapper">
              <table className="sql-result-table editable">
                <thead>
                  <tr>
                    {tableSchema.map((col: any) => (
                      <th key={col.name}>
                        {col.name}
                        <span className="col-type">{col.type}</span>
                        {col.pk === 1 && <span className="pk-badge">PK</span>}
                      </th>
                    ))}
                    <th className="action-col">{t('admin.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {addingRow && (
                    <tr className="new-row">
                      {tableSchema.map((col: any) => (
                        <td key={col.name}>
                          {col.pk === 1 && col.type === 'INTEGER' ? (
                            <span className="auto-text">AUTO</span>
                          ) : (
                            <input
                              type="text"
                              className="cell-input"
                              value={newRowData[col.name] ?? ''}
                              onChange={(e) => setNewRowData({ ...newRowData, [col.name]: e.target.value })}
                              placeholder={col.type}
                            />
                          )}
                        </td>
                      ))}
                      <td className="action-col">
                        <button className="btn btn-primary btn-xs" onClick={handleAddRow}>
                          {t('admin.saveRow')}
                        </button>
                        <button className="btn btn-secondary btn-xs" onClick={() => setAddingRow(false)}>
                          {t('common.cancel')}
                        </button>
                      </td>
                    </tr>
                  )}
                  {tableData.map((row: any, rowIdx: number) => (
                    <tr key={rowIdx}>
                      {tableSchema.map((col: any) => (
                        <td
                          key={col.name}
                          onDoubleClick={() => handleCellEdit(rowIdx, col.name, row[col.name])}
                          className={editingCell?.row === rowIdx && editingCell?.col === col.name ? 'editing' : ''}
                          title={row[col.name] === null ? 'NULL' : String(row[col.name])}
                        >
                          {editingCell?.row === rowIdx && editingCell?.col === col.name ? (
                            <input
                              type="text"
                              className="cell-input"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onBlur={() => handleCellSave(rowIdx)}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleCellSave(rowIdx); if (e.key === 'Escape') setEditingCell(null); }}
                              autoFocus
                            />
                          ) : (
                            <span className={`cell-value ${row[col.name] === null ? 'null-value' : ''}`}>
                              {row[col.name] === null ? 'NULL' : String(row[col.name]).substring(0, 100)}
                            </span>
                          )}
                        </td>
                      ))}
                      <td className="action-col">
                        <button
                          className="btn btn-danger btn-xs"
                          onClick={() => handleDeleteRow(row)}
                        >
                          {t('admin.deleteRow')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tablePagination && tablePagination.totalPages > 1 && (
            <div className="pm-pagination">
              <button className="btn btn-secondary btn-sm" disabled={tablePage <= 1} onClick={() => setTablePage(tablePage - 1)}>
                <ChevronLeft size={14} />
              </button>
              <span className="pm-page-info">{tablePage} / {tablePagination.totalPages}</span>
              <button className="btn btn-secondary btn-sm" disabled={tablePage >= tablePagination.totalPages} onClick={() => setTablePage(tablePage + 1)}>
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </>
      )}

      {showPasswordModal && (
        <div className="modal-overlay" onClick={() => setShowPasswordModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>{t('admin.confirmDelete')}</h3>
            <p style={{color:'var(--text-secondary)',fontSize:'14px',marginBottom:'16px'}}>
              {t('admin.deleteConfirmMsg')}
            </p>
            <div className="form-group">
              <input
                type="password"
                className="form-input"
                value={sqlPassword}
                onChange={(e) => setSqlPassword(e.target.value)}
                placeholder={t('admin.enterPassword')}
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setShowPasswordModal(false); setSqlPassword(''); }}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-danger" onClick={confirmDeleteWithPassword} disabled={!sqlPassword}>
                {t('admin.confirmDelete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
