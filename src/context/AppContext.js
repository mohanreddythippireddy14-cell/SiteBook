import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { getSites, getWorkers, getAdvances, getHolidays } from '../services/firestore';

const AppContext = createContext({});

// FIX BUG-17: use separate state updaters so one listener update
// does NOT cascade re-render to unrelated state
export const AppProvider = ({ userId, children }) => {
  const [sites,       setSites]       = useState([]);
  const [workers,     setWorkers]     = useState([]);
  const [advances,    setAdvances]    = useState([]);
  const [holidays,    setHolidays]    = useState([]);
  const [currentSite, setCurrentSiteRaw] = useState(null);
  const [dataErrors,  setDataErrors]  = useState({});

  useEffect(() => {
    if (!userId) return;
    const onDataError = (error, label) => {
      setDataErrors((prev) => ({
        ...prev,
        [label]: error?.message || 'Could not load app data. Please check your connection.',
      }));
    };
    const clearDataError = (label) => setDataErrors((prev) => {
      if (!prev[label]) return prev;
      const next = { ...prev };
      delete next[label];
      return next;
    });

    const u1 = getSites(userId, (data) => {
      clearDataError('sites');
      setSites(data);
      // Only auto-set if no site is selected yet
      setCurrentSiteRaw(prev => {
        if (prev) {
          // Keep current if it still exists
          const stillExists = data.find(s => s.id === prev.id);
          return stillExists || (data[0] ?? null);
        }
        return data[0] ?? null;
      });
    }, onDataError);
    const u2 = getWorkers(userId, (data) => { clearDataError('workers'); setWorkers(data); }, onDataError);
    const u3 = getAdvances(userId, (data) => { clearDataError('advances'); setAdvances(data); }, onDataError);
    const u4 = getHolidays(userId, (data) => { clearDataError('holidays'); setHolidays(data); }, onDataError);
    return () => { u1(); u2(); u3(); u4(); };
  }, [userId]);

  // FIX BUG-17: memoize derived values to avoid cascading renders
  const siteWorkers = useMemo(
    () => workers.filter(w => w.siteId === currentSite?.id),
    [workers, currentSite?.id]
  );

  const setCurrentSite = useCallback((site) => {
    setCurrentSiteRaw(site);
  }, []);

  const dataError = useMemo(() => {
    const [label, message] = Object.entries(dataErrors)[0] || [];
    return label ? { label, message } : null;
  }, [dataErrors]);

  const value = useMemo(() => ({
    sites, workers, advances, holidays,
    currentSite, setCurrentSite, siteWorkers, userId, dataError,
  }), [sites, workers, advances, holidays, currentSite, siteWorkers, userId, dataError]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = () => useContext(AppContext);
