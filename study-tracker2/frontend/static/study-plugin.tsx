import { useState, useEffect } from 'preact/hooks';
import type { JSXInternal } from 'preact/src/jsx';

interface Subject {
  id: number;
  name: string;
  category: string;
  done: number;
  total: number;
  pct: number;
}

interface TodayStats {
  done: number;
  total: number;
  srs_total: number;
  srs_done: number;
}

export function App(): JSXInternal.Element {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [stats, setStats] = useState<TodayStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState('http://localhost:8000');
  const i18n = window.Blinko.i18n;

  useEffect(() => {
    fetchTodayProgress();
  }, []);

  const fetchTodayProgress = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${baseUrl}/api/stats/today`);
      if (!response.ok) throw new Error('Failed to fetch stats');
      const data = await response.json();
      setStats(data);

      const subjectsResponse = await fetch(`${baseUrl}/api/subjects`);
      if (!subjectsResponse.ok) throw new Error('Failed to fetch subjects');
      const subjectsData = await subjectsResponse.json();
      
      const processedSubjects = subjectsData.map((s: any) => {
        const quota = s.daily_quota || 0;
        const done = quota > 0 ? Math.floor((s.mastered || 0) + (s.pass2_done || 0) * 0.5) : 0;
        const total = quota > 0 ? quota * 2 : (s.total || 0) * 2;
        return {
          id: s.id,
          name: s.name,
          category: s.category,
          done: done,
          total: total,
          pct: total > 0 ? Math.round((done / total) * 100) : 0
        };
      });
      setSubjects(processedSubjects);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleBaseUrlChange = (e: string) => {
    setBaseUrl(e);
    window.Blinko.api.config.setPluginConfig.mutate({
      pluginName: 'study-tracker2',
      key: 'baseUrl',
      value: e
    });
  };

  useEffect(() => {
    window.Blinko.api.config.getPluginConfig.query({
      pluginName: 'study-tracker2'
    }).then((res: any) => {
      if (res && res.baseUrl) {
        setBaseUrl(res.baseUrl);
      }
    });
  }, []);

  if (loading) {
    return (
      <div className="p-4 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
        <p className="mt-2 text-sm">{i18n.t('loading')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
          <strong className="font-bold">{i18n.t('error')}</strong>
          <span className="block sm:inline"> {error}</span>
        </div>
        <div className="mt-4">
          <label className="block text-sm font-medium mb-2">
            {i18n.t('baseUrl')}
            <input
              value={baseUrl}
              onChange={(e) => handleBaseUrlChange(e.currentTarget.value)}
              placeholder="http://localhost:8000"
              className="mt-1 block w-full px-3 py-2 border rounded-md shadow-sm sm:text-sm bg-primary!"
            />
          </label>
        </div>
      </div>
    );
  }

  const grandTotal = stats?.total || 0;
  const grandDone = stats?.done || 0;
  const grandPct = grandTotal > 0 ? Math.round((grandDone / grandTotal) * 100) : 0;

  return (
    <div className="max-w-md mx-auto p-2">
      <div className="mb-4">
        <label className="block text-xs font-medium mb-1">
          {i18n.t('baseUrl')}
          <input
            value={baseUrl}
            onChange={(e) => handleBaseUrlChange(e.currentTarget.value)}
            placeholder="http://localhost:8000"
            className="mt-1 block w-full px-2 py-1 text-xs border rounded shadow-sm bg-primary!"
          />
        </label>
      </div>

      <div className="mb-4 p-3 bg-primary/10 rounded-lg">
        <h2 className="text-sm font-semibold mb-2">{i18n.t('todayProgress')}</h2>
        <div className="flex justify-between text-sm mb-1">
          <span>{grandDone} / {grandTotal}</span>
          <span className="font-bold">{grandPct}%</span>
        </div>
        <div className="w-full bg-primary/20 rounded-full h-2">
          <div 
            className="bg-primary h-2 rounded-full transition-all duration-500" 
            style={{ width: `${grandPct}%` }}
          ></div>
        </div>
      </div>

      <div className="space-y-2">
        {subjects.length === 0 ? (
          <p className="text-center text-sm text-desc">{i18n.t('noSubjects')}</p>
        ) : (
          subjects.map((subject) => (
            <div key={subject.id} className="p-2 bg-primary/5 rounded-lg">
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium">{subject.name}</span>
                <span>{subject.pct}%</span>
              </div>
              <div className="w-full bg-primary/20 rounded-full h-1.5">
                <div 
                  className="bg-primary h-1.5 rounded-full" 
                  style={{ width: `${subject.pct}%` }}
                ></div>
              </div>
              <p className="text-xs text-desc mt-1">
                {subject.done} / {subject.total}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
