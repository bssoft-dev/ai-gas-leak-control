import React, { useEffect, useState } from 'react';
import GasLeakControlDashboard from './components/GasLeakControlDashboard';
import './App.css';
import { DefaultService, OpenAPI } from './api';

// --- Type Definitions ---
interface ServiceInfo {
  id: string;
  version: string;
  name: string;
  description: string;
  author: string;
  icon: string;
  category: string;
  domain: string;
}

interface InterfaceDef {
  type: string;
  id: string;
  label: string;
  description: string;
  component: string;
  binding: string;
  props: Record<string, any>;
  events: Record<string, string>;
}

// Configure the API client
OpenAPI.BASE = ''; // Use the current host, which will be proxied by Vite

function App() {
  const [interfaceDef, setInterfaceDef] = useState<InterfaceDef | null>(null);
  const [serviceInfo, setServiceInfo] = useState<ServiceInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        // Use the generated API client
        const [service, interfaces] = await Promise.all([
          DefaultService.getServiceInfoApiServiceGet(),
          DefaultService.getInterfacesApiInterfacesGet(),
        ]);
        
        setServiceInfo(service as ServiceInfo);
        setInterfaceDef(interfaces[0] as InterfaceDef || null);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const handleEvent = async (eventName: string, payload: any) => {
    if (!interfaceDef?.events) return;
    const eventType = interfaceDef.events[eventName];
    if (!eventType) return;
    try {
      // Use the generated API client
      await DefaultService.publishEventApiEventsPublishPost({
        type: eventType,
        payload: payload || {},
      });
    } catch (err) {
      console.error('Failed to publish event:', err);
    }
  };

  if (loading) return <div className="app-loading"><div className="spinner"></div><p>로딩 중...</p></div>;
  if (error) return <div className="app-error"><h2>오류</h2><p>{error}</p></div>;
  if (!interfaceDef) return <div className="app-error"><h2>인터페이스를 찾을 수 없습니다</h2></div>;

  return (
    <div className="app">
      <header className="app-header">
        <h1>{serviceInfo?.name || 'AI 가스 누출 자동제어'}</h1>
        <p className="app-description">{interfaceDef.description}</p>
      </header>
      <main className="app-main">
        <GasLeakControlDashboard
          onAction={handleEvent}
          events={interfaceDef.events}
        />
      </main>
    </div>
  );
}

export default App;