import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface ToastState {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [counter, setCounter] = useState(0);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    setCounter(prev => prev + 1);
    setToast({ id: counter + 1, message, type });
  }, [counter]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 md:left-auto md:right-8 md:translate-x-0 z-50 px-5 py-3 rounded-2xl shadow-2xl text-sm font-semibold flex items-center gap-3
            ${toast.type === 'success' ? 'bg-emerald-500 text-white' : toast.type === 'error' ? 'bg-rose-500 text-white' : 'bg-slate-800 text-white'}`}
        >
          {toast.type === 'success' ? '✅' : toast.type === 'error' ? '⚠️' : '💡'}
          <span className="whitespace-pre-line">{toast.message}</span>
        </div>
      )}
    </ToastContext.Provider>
  );
};


