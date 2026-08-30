import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { BarChart3, Flame, CalendarDays, CheckCircle, Send, Tag, Trophy, ChevronLeft, ChevronRight } from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { t } from '../i18n';
import './AnnualReport.css';

export default function AnnualReport() {
  const { user } = useAuthStore();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useDocumentTitle(t('annualReport.title'));

  const fetchReport = useCallback(async (y: number) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getAnnualReport(y);
      setReport(data);
    } catch (e: any) {
      setError(e.message || t('common.error'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReport(year);
  }, [year, fetchReport]);

  if (!user) {
    return (
      <div className="annual-report-page">
        <div className="empty">{t('annualReport.pleaseLogin')}</div>
      </div>
    );
  }

  const acRate = report && report.total_submissions > 0
    ? Math.round((report.accepted / report.total_submissions) * 100) : 0;

  return (
    <div className="annual-report-page">
      <div className="report-header">
        <h1><BarChart3 size={22} /> {t('annualReport.title')}</h1>
        <div className="report-year-nav">
          <button className="btn btn-secondary btn-sm" disabled={year <= 2015} onClick={() => setYear(year - 1)}>
            <ChevronLeft size={14} />
          </button>
          <span className="report-year">{year}</span>
          <button className="btn btn-secondary btn-sm" disabled={year >= currentYear} onClick={() => setYear(year + 1)}>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="loading-container"><div className="loading-spinner"></div></div>
      ) : error || !report ? (
        <div className="empty">{error || t('annualReport.noData')}</div>
      ) : report.total_submissions === 0 ? (
        <div className="empty">{t('annualReport.noData')}</div>
      ) : (
        <>
          <div className="report-stats-grid">
            <div className="report-stat-card">
              <Send size={20} className="stat-icon blue" />
              <div className="stat-num">{report.total_submissions}</div>
              <div className="stat-label">{t('annualReport.totalSubmissions')}</div>
            </div>
            <div className="report-stat-card">
              <CheckCircle size={20} className="stat-icon green" />
              <div className="stat-num">{report.accepted}</div>
              <div className="stat-label">{t('annualReport.accepted')} ({acRate}%)</div>
            </div>
            <div className="report-stat-card">
              <Trophy size={20} className="stat-icon purple" />
              <div className="stat-num">{report.solved_problems}</div>
              <div className="stat-label">{t('annualReport.solvedProblems')}</div>
            </div>
            <div className="report-stat-card">
              <CalendarDays size={20} className="stat-icon orange" />
              <div className="stat-num">{report.practice_days}</div>
              <div className="stat-label">{t('annualReport.practiceDays')}</div>
            </div>
            <div className="report-stat-card">
              <Flame size={20} className="stat-icon red" />
              <div className="stat-num">{report.longest_streak}</div>
              <div className="stat-label">{t('annualReport.longestStreak')}</div>
            </div>
          </div>

          {report.monthly.length > 0 && (
            <div className="report-section">
              <h2 className="section-title">{t('annualReport.monthly')}</h2>
              <div className="report-monthly">
                {(() => {
                  const max = Math.max(1, ...report.monthly.map((m: any) => m.total));
                  return report.monthly.map((m: any) => (
                    <div key={m.month} className="monthly-col" title={`${m.month}: ${m.accepted} AC / ${m.total} ${t('annualReport.submissions')}`}>
                      <div className="monthly-bars">
                        <div className="monthly-ac" style={{ height: `${(m.accepted / max) * 100}%` }} />
                        <div className="monthly-total" style={{ height: `${(m.total / max) * 100}%` }} />
                      </div>
                      <span className="monthly-label">{m.month.slice(5)}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}

          {report.top_tags.length > 0 && (
            <div className="report-section">
              <h2 className="section-title"><Tag size={16} /> {t('annualReport.topTags')}</h2>
              <div className="report-tags">
                {report.top_tags.map((tg: any, i: number) => (
                  <span key={tg.tag} className="report-tag">
                    <span className="tag-rank">{i + 1}</span>
                    {tg.tag}
                    <span className="tag-count">{tg.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="report-footer">
            <Link to="/profile" className="btn btn-secondary btn-sm">← {t('common.back')}</Link>
          </div>
        </>
      )}
    </div>
  );
}
