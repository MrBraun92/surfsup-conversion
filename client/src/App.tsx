import { useEffect, useState } from "react";
import { Routes, Route, NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Waves,
  CheckCircle2,
  MessageSquare,
  DollarSign,
  Users,
  Upload,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { Dashboard } from "./pages/Dashboard";
import { Importar } from "./pages/Importar";
import { Alugueis } from "./pages/Alugueis";
import { Aprovacoes } from "./pages/Aprovacoes";
import { Vendas } from "./pages/Vendas";
import { Conversas } from "./pages/Conversas";
import { Clientes } from "./pages/Clientes";
import { Pay } from "./pages/Pay";
import { Configuracoes } from "./pages/Configuracoes";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/alugueis", label: "Aluguéis", icon: Waves },
  { to: "/aprovacoes", label: "Aprovações", icon: CheckCircle2 },
  { to: "/conversas", label: "Conversas", icon: MessageSquare },
  { to: "/vendas", label: "Vendas", icon: DollarSign },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/importar", label: "Importar", icon: Upload },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

const SIDEBAR_KEY = "surfsup_sidebar_collapsed";

export function App() {
  const location = useLocation();
  const isStandaloneRoute = location.pathname.startsWith("/pay/");

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_KEY) === "1";
  });

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  if (isStandaloneRoute) {
    return (
      <Routes>
        <Route path="/pay/:sessionId" element={<Pay />} />
      </Routes>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside
        className={`border-r bg-white flex flex-col gap-1 transition-[width] duration-200 ease-out ${
          collapsed ? "w-14" : "w-56"
        }`}
      >
        <div
          className={`flex items-center ${
            collapsed ? "justify-center" : "justify-between"
          } px-3 pt-4 pb-2`}
        >
          {!collapsed && <div className="text-lg font-bold">🏄 Surfsup</div>}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition"
            title={collapsed ? "Expandir menu" : "Recolher menu"}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        <nav className="flex flex-col gap-1 px-2 mt-2">
          {navItems.map((it) => {
            const Icon = it.icon;
            return (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.end}
                title={collapsed ? it.label : undefined}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-2.5 py-2 rounded text-sm transition ${
                    isActive ? "bg-slate-900 text-white" : "hover:bg-slate-100 text-slate-700"
                  } ${collapsed ? "justify-center" : ""}`
                }
              >
                <Icon size={18} className="shrink-0" />
                {!collapsed && <span className="truncate">{it.label}</span>}
              </NavLink>
            );
          })}
        </nav>
      </aside>
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/alugueis" element={<Alugueis />} />
          <Route path="/aprovacoes" element={<Aprovacoes />} />
          <Route path="/conversas" element={<Conversas />} />
          <Route path="/vendas" element={<Vendas />} />
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/importar" element={<Importar />} />
          <Route path="/configuracoes" element={<Configuracoes />} />
        </Routes>
      </main>
    </div>
  );
}
