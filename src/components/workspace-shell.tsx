'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Activity, BarChart3, BookOpenCheck, ChevronLeft, ChevronRight, CircleUserRound, FileSpreadsheet, LayoutDashboard, ListChecks, Menu, Settings2, Shield, UsersRound, X } from 'lucide-react';

const iconFor: Record<string, React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>> = {
  '/dashboard': LayoutDashboard, '/audits': ListChecks, '/profile': CircleUserRound,
  '/google-sheets': FileSpreadsheet, '/adoption': BarChart3, '/counsellors': UsersRound,
  '/reports': Activity, '/settings': Settings2, '/users': Shield, '/teams': BookOpenCheck,
};

export default function WorkspaceShell({ children, nav, name, role }: { children: React.ReactNode; nav: [string, string][]; name: string; role: string }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { setCollapsed(localStorage.getItem('learningshala-sidebar') === 'collapsed'); }, []);
  function toggleSidebar() { setCollapsed(value => { const next = !value; localStorage.setItem('learningshala-sidebar', next ? 'collapsed' : 'expanded'); return next; }); }

  return <div className={`workspace-shell${collapsed ? ' sidebar-collapsed' : ''}`}>
    {mobileOpen && <button className="mobile-scrim" type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar${collapsed ? ' is-collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`}>
      <div className="sidebar-brand-row"><Link className="brand" href="/dashboard" onClick={() => setMobileOpen(false)}><span className="brand-mark">L</span><span className="brand-copy">Learningshala<small>QUALITY OPERATIONS</small></span></Link><button className="sidebar-toggle" type="button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={toggleSidebar}>{collapsed ? <ChevronRight size={18}/> : <ChevronLeft size={18}/>}</button><button className="sidebar-close" type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={18}/></button></div>
      <div className="navlabel">WORKSPACE</div>
      <nav className="sidebar-nav" aria-label="Main navigation">{nav.map(([label, href]) => {
        const Icon = iconFor[href] ?? ListChecks;
        const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(`${href}/`));
        return <Link className={`nav${active ? ' active' : ''}`} href={href} key={href} title={collapsed ? label : undefined} aria-current={active ? 'page' : undefined} onClick={() => setMobileOpen(false)}><Icon size={18} aria-hidden/><span>{label}</span></Link>;
      })}</nav>
      <div className="sidebar-footer"><div className="profile-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</div><div className="sidefoot"><b>{name}</b><small>{role === 'AUDITOR' ? 'QUALITY AUDITOR' : role}</small></div></div>
    </aside>
    <main className="main">
      <header className="top"><div className="top-leading"><button className="mobile-menu" type="button" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={20}/></button><div><strong>Audit &amp; Adoption Management</strong><span>Quality operations workspace</span></div></div><form action="/api/auth/logout" method="post"><button className="btn btn-quiet" type="submit">Sign out</button></form></header>
      <div className="route-content" key={pathname}>{children}</div>
    </main>
  </div>;
}
