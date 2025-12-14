
import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { User } from './types';
import { cloudService } from './services/cloudService';
import { setLanguage } from './utils/translations';
import AuthPage from './components/AuthPage';
import LandingPage from './components/LandingPage';
import Dashboard from './components/Dashboard';
import ProjectBuilder from './components/ProjectBuilder';
import PreviewPage from './components/PreviewPage';
import CloudManagementPage from './components/CloudManagementPage';
import AdminPanel from './components/AdminPanel';
import PaymentCallback from './components/PaymentCallback';
import { Loader2, RefreshCw, AlertTriangle } from 'lucide-react';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const initSession = async () => {
      setLoading(true);
      setError(null);
      
      // Safety Timeout: 15s provides ample time for cold starts while ensuring the user isn't stuck forever.
      const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Connection timed out")), 15000)
      );

      try {
        await Promise.race([
            (async () => {
                const currentUser = await cloudService.getCurrentUser();
                setUser(currentUser);
                if (currentUser) {
                    const lang = await cloudService.getUserLanguage(currentUser.id);
                    if (lang && (lang === 'en' || lang === 'fa')) {
                        setLanguage(lang as 'en' | 'fa');
                    }
                }
            })(),
            timeoutPromise
        ]);
      } catch (e: any) {
        console.error("Session check failed", e);
        // Don't block the app, just let them try to login again or show error
        setError("Unable to connect to the server. Please check your internet connection.");
      } finally {
        setLoading(false);
      }
  };

  useEffect(() => {
    initSession();

    const unsubscribe = cloudService.onAuthStateChange(async (u) => {
      setUser(u);
      if (u) {
          const lang = await cloudService.getUserLanguage(u.id);
          if (lang && (lang === 'en' || lang === 'fa')) {
              setLanguage(lang as 'en' | 'fa');
          }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleLogin = (loggedInUser: User) => {
      setUser(loggedInUser);
      navigate('/dashboard');
  };

  const handleLogout = async () => {
      await cloudService.logout();
      setUser(null);
      navigate('/');
  };

  if (loading) {
      return (
          <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center text-indigo-500 gap-4">
              <Loader2 className="animate-spin" size={48} />
              <p className="text-slate-400 text-sm animate-pulse">Connecting to Rafiei Cloud...</p>
          </div>
      );
  }

  if (error && !user) {
      return (
          <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center text-white gap-6 p-4">
              <div className="p-4 bg-red-500/10 rounded-full border border-red-500/20 text-red-400">
                  <AlertTriangle size={32} />
              </div>
              <div className="text-center">
                  <h2 className="text-xl font-bold mb-2">Connection Issue</h2>
                  <p className="text-slate-400 max-w-xs mx-auto">{error}</p>
              </div>
              <button 
                  onClick={initSession}
                  className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-medium transition-colors"
              >
                  <RefreshCw size={18} /> Retry Connection
              </button>
          </div>
      );
  }

  const isAdmin = user?.isAdmin;

  return (
    <Routes>
        <Route path="/" element={user ? <Navigate to="/dashboard" /> : <LandingPage />} />
        
        <Route path="/auth" element={
            user ? <Navigate to="/dashboard" /> : <AuthPage onLogin={handleLogin} />
        } />
        
        <Route path="/dashboard" element={
            user ? <Dashboard user={user} onLogout={handleLogout} view="active" /> : <Navigate to="/auth" state={{ from: location }} />
        } />

        <Route path="/dashboard/trash" element={
            user ? <Dashboard user={user} onLogout={handleLogout} view="trash" /> : <Navigate to="/auth" state={{ from: location }} />
        } />
        
        <Route path="/project/:projectId" element={
            user ? <ProjectBuilder user={user} /> : <Navigate to="/auth" state={{ from: location }} />
        } />
        
        <Route path="/cloud/:projectId" element={
            user ? <CloudManagementPage user={user} /> : <Navigate to="/auth" state={{ from: location }} />
        } />

        <Route path="/preview/:projectId/*" element={<PreviewPage />} />

        <Route path="/payment/verify" element={<PaymentCallback />} />

        <Route path="/admin" element={
            isAdmin ? <AdminPanel user={user!} onClose={() => navigate('/dashboard')} /> : <Navigate to="/dashboard" />
        } />
        
        <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
};

export default App;
