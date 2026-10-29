import { useQueryClient } from '@tanstack/react-query';
import { Briefcase, CircleAlert, CreditCard, FlaskConical, LayoutDashboard, LogOut, Menu as MenuIcon, MonitorDown, Search, Settings, ShieldCheck, UserRound } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import type { Me } from '@shared/types';
import { ROLE_LABEL } from '@shared/types';
import { api } from '../api';
import { fmtDay, plural, useHotkey, useInstallPrompt } from '../hooks';
import { CommandPalette } from './CommandPalette';
import { Drawer, Menu } from './overlay';
import { Avatar, IconButton, Logo } from './ui';

function Nav({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  return (
    <nav className="nav" aria-label="Hlavní navigace">
      <NavLink to="/" end className="nav-item" onClick={onNavigate}><LayoutDashboard aria-hidden />Přehled</NavLink>
      <NavLink to="/pozice" className="nav-item" onClick={onNavigate}><Briefcase aria-hidden />Pozice</NavLink>
      <NavLink to="/nastaveni" className="nav-item" onClick={onNavigate}><Settings aria-hidden />Nastavení</NavLink>
      {me.isPlatformAdmin && <NavLink to="/sprava" className="nav-item" onClick={onNavigate}><ShieldCheck aria-hidden />Správa</NavLink>}
    </nav>
  );
}

/** Upozornění na předplatné: neaktivní (hodnocení vypnuté) nebo brzy končící. */
function SubscriptionBanner({ me }: { me: Me }) {
  const s = me.organization.subscription;
  if (!s.enabled || me.organization.isDemo) return null;
  const link = <Link to="/nastaveni/predplatne" className="banner-link">{s.status === 'active' ? 'Předplatné' : s.requestedPlan ? 'Detail objednávky' : 'Vybrat tarif'}</Link>;
  if (s.status === 'pending' || s.status === 'expired') {
    const text = s.requestedPlan
      ? `Objednávka tarifu ${s.requestedPlan.name} čeká na zaplacení. Hodnocení životopisů se zapne po aktivaci.`
      : s.status === 'expired' && s.paidUntil
        ? `Předplatné skončilo ${fmtDay(s.paidUntil)}. Hodnocení je pozastavené, vaše data zůstávají.`
        : 'Předplatné zatím není aktivní. Pozice si můžete připravit, hodnocení životopisů se zapne po aktivaci tarifu.';
    return <div className="banner banner-warning" role="status"><CircleAlert aria-hidden /><span>{text}</span>{link}</div>;
  }
  if (s.status === 'active' && s.paidUntil && s.daysLeft !== null && s.daysLeft <= 7) {
    const left = s.daysLeft === 0 ? 'dnes' : `za ${plural(s.daysLeft, 'den', 'dny', 'dní')}`;
    return <div className="banner banner-info" role="status"><CreditCard aria-hidden /><span>Předplatné končí {left} ({fmtDay(s.paidUntil)}).</span>{link}</div>;
  }
  return null;
}

export function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  const install = useInstallPrompt();
  useHotkey('k', useCallback(() => setPaletteOpen((o) => !o), []), { meta: true });

  const logout = async () => {
    try { await api.post('/auth/logout'); } finally {
      qc.clear();
      qc.setQueryData(['me'], null);
      navigate('/prihlaseni', { replace: true });
    }
  };

  const account = (
    <Menu
      align="start"
      trigger={
        <button type="button" className="account" aria-label="Účet a odhlášení">
          <Avatar name={me.user.name} />
          <span className="account-text">
            <span className="ellipsis" style={{ fontWeight: 500 }}>{me.user.name}</span>
            <span className="ellipsis xs muted">{me.organization.name} · {ROLE_LABEL[me.role]}</span>
          </span>
        </button>
      }
      actions={[
        { label: 'Můj profil', icon: <UserRound />, onSelect: () => navigate('/nastaveni') },
        { label: 'Odhlásit se', icon: <LogOut />, onSelect: logout, separatorBefore: true },
      ]}
    />
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <Link to="/" className="brand" aria-label="Sítko, přehled"><Logo /><span className="brand-name">Sítko</span></Link>
        <button type="button" className="palette-btn" onClick={() => setPaletteOpen(true)}>
          <Search width={16} height={16} aria-hidden />Hledat a přejít<kbd aria-hidden>Ctrl K</kbd>
        </button>
        <div style={{ height: 8 }} />
        <Nav me={me} />
        <div className="sidebar-foot">
          {install && (
            <button type="button" className="nav-item" style={{ background: 'none', width: '100%' }} onClick={() => void install()}>
              <MonitorDown aria-hidden />Nainstalovat aplikaci
            </button>
          )}
          {account}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <IconButton label="Otevřít menu" onClick={() => setDrawerOpen(true)}><MenuIcon /></IconButton>
          <Link to="/" className="brand" style={{ padding: 0 }}><Logo size={22} /><span className="brand-name">Sítko</span></Link>
          <span className="spacer" />
          <IconButton label="Hledat a přejít" onClick={() => setPaletteOpen(true)}><Search /></IconButton>
        </header>
        {me.organization.isDemo && (
          <div className="banner banner-demo" role="note">
            <FlaskConical aria-hidden />
            <span>Ukázková organizace: životopisy jsou fiktivní a výsledky předpřipravené, nejde o analýzu AI.</span>
          </div>
        )}
        <SubscriptionBanner me={me} />
        <main id="obsah" key={location.pathname.split('/').slice(0, 3).join('/')}>{children}</main>
      </div>

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen} title="Navigace">
        <Link to="/" className="brand" onClick={() => setDrawerOpen(false)}><Logo /><span className="brand-name">Sítko</span></Link>
        <Nav me={me} onNavigate={() => setDrawerOpen(false)} />
        <div className="sidebar-foot">{account}</div>
      </Drawer>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
