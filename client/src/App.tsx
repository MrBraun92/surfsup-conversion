import { Routes, Route, NavLink, useLocation } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { Importar } from "./pages/Importar";
import { Alugueis } from "./pages/Alugueis";
import { Aprovacoes } from "./pages/Aprovacoes";
import { Vendas } from "./pages/Vendas";
import { Pay } from "./pages/Pay";

const navItems = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/alugueis", label: "Aluguéis" },
  { to: "/aprovacoes", label: "Aprovações" },
  { to: "/conversas", label: "Conversas" },
  { to: "/vendas", label: "Vendas" },
  { to: "/clientes", label: "Clientes" },
  { to: "/importar", label: "Importar" },
  { to: "/configuracoes", label: "Configurações" },
];

function Placeholder({ title }: { title: string }) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-slate-500 mt-2">Em construção.</p>
    </div>
  );
}

export function App() {
  const location = useLocation();
  const isStandaloneRoute = location.pathname.startsWith("/pay/");

  if (isStandaloneRoute) {
    return (
      <Routes>
        <Route path="/pay/:sessionId" element={<Pay />} />
      </Routes>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r bg-white p-4 flex flex-col gap-1">
        <div className="text-lg font-bold mb-4">🏄 Surfsup</div>
        {navItems.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              `px-3 py-2 rounded text-sm ${isActive ? "bg-slate-900 text-white" : "hover:bg-slate-100"}`
            }
          >
            {it.label}
          </NavLink>
        ))}
      </aside>
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/alugueis" element={<Alugueis />} />
          <Route path="/aprovacoes" element={<Aprovacoes />} />
          <Route path="/conversas" element={<Placeholder title="Conversas" />} />
          <Route path="/vendas" element={<Vendas />} />
          <Route path="/clientes" element={<Placeholder title="Clientes" />} />
          <Route path="/importar" element={<Importar />} />
          <Route path="/configuracoes" element={<Placeholder title="Configurações" />} />
        </Routes>
      </main>
    </div>
  );
}
