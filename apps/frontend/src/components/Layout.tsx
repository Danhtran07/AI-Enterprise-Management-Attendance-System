import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { useState } from "react";
import {
  CalendarCheck2,
  CalendarDays,
  LayoutDashboard,
  LogOut,
  ScanFace,
  UserRound,
  UsersRound,
} from "lucide-react";

interface StoredUser {
  username?: string;
  role?: string;
}

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();

  const [mobileMenuOpen, setMobileMenuOpen] =
    useState(false);

  const storedUser =
    localStorage.getItem("user");

  let user: StoredUser = {};

  try {
    user = storedUser
      ? JSON.parse(storedUser)
      : {};
  } catch {
    user = {};
  }

  const username =
    user.username || "User";

  const role =
    user.role || "EMPLOYEE";

  const avatar =
    username.charAt(0).toUpperCase();

  const isDashboardActive =
    location.pathname === "/dashboard";

  const isEmployeesActive =
    location.pathname.startsWith(
      "/employees"
    );

  const isAttendanceActive =
  location.pathname.startsWith(
    "/attendance"
  );

const isUsersActive =
  location.pathname.startsWith(
    "/users"
  );

  const isWorkConfigActive =
    location.pathname.startsWith("/schedules") ||
    location.pathname.startsWith("/shifts");


  function handleLogout() {
    localStorage.removeItem(
      "access_token"
    );

    localStorage.removeItem(
      "user"
    );

    navigate("/login", {
      replace: true,
    });
  }

  function closeMobileMenu() {
    setMobileMenuOpen(false);
  }

  return (
    <div className="min-h-screen bg-slate-50">

      {/* =====================================================
          MOBILE OVERLAY
      ===================================================== */}

      {mobileMenuOpen && (
        <div
          className="
            fixed inset-0 z-40
            bg-slate-900/40
            backdrop-blur-sm
            lg:hidden
          "
          onClick={closeMobileMenu}
        />
      )}

      {/* =====================================================
          SIDEBAR
      ===================================================== */}

      <aside
        className={`
          fixed inset-y-0 left-0 z-50
          flex w-64 flex-col
          border-r border-slate-200
          bg-white
          transition-transform duration-200
          lg:translate-x-0

          ${
            mobileMenuOpen
              ? "translate-x-0"
              : "-translate-x-full"
          }
        `}
      >

        {/* ===================================================
            BRAND
        =================================================== */}

        <div
          className="
            flex h-20
            items-center
            border-b border-slate-100
            px-6
          "
        >

          <div
            className="
              flex h-10 w-10
              shrink-0
              items-center justify-center
              rounded-xl
              bg-blue-600
              text-lg font-extrabold
              text-white
              shadow-sm
            "
          >
            F
          </div>

          <div className="ml-3">

            <div
              className="
                text-lg font-extrabold
                tracking-tight
                text-slate-900
              "
            >
              FaceAttend
            </div>

            <div
              className="
                text-[10px]
                font-semibold
                uppercase
                tracking-wider
                text-slate-400
              "
            >
              Attendance System
            </div>

          </div>

          {/* Mobile close */}

          <button
            type="button"
            onClick={closeMobileMenu}
            className="
              ml-auto
              flex h-8 w-8
              items-center justify-center
              rounded-lg
              text-slate-400
              hover:bg-slate-100
              hover:text-slate-700
              lg:hidden
            "
          >
            ×
          </button>

        </div>


        {/* ===================================================
            NAVIGATION
        =================================================== */}

        <nav className="flex-1 px-4 py-6">

          <div
            className="
              mb-3 px-3
              text-[10px]
              font-bold
              uppercase
              tracking-[0.12em]
              text-slate-400
            "
          >
            Main Menu
          </div>


          {/* Dashboard */}

          <Link
            to="/dashboard"
            onClick={closeMobileMenu}
            className={`
              mb-1
              flex items-center
              gap-3
              rounded-xl
              px-3.5 py-3
              text-sm font-semibold
              no-underline
              transition

              ${
                isDashboardActive
                  ? "bg-blue-50 text-blue-600"
                  : "text-slate-600 hover:bg-slate-50 hover:text-blue-600"
              }
            `}
          >

            <span
              className={`
                flex h-9 w-9
                items-center justify-center
                rounded-lg
                text-lg

                ${
                  isDashboardActive
                    ? "bg-white text-blue-600 shadow-sm"
                    : "bg-slate-100 text-slate-500"
                }
              `}
            >
              <LayoutDashboard size={18} strokeWidth={2} />
            </span>

            <span>
              Dashboard
            </span>

          </Link>


          {/* Face Attendance */}

          <Link
            to="/recognition"
            onClick={closeMobileMenu}
            className="
              mb-1
              flex items-center
              gap-3
              rounded-xl
              px-3.5 py-3
              text-sm font-semibold
              no-underline
              transition
              text-slate-600
              hover:bg-blue-50
              hover:text-blue-600
            "
          >
            <span
              className="
                flex h-9 w-9
                items-center justify-center
                rounded-lg
                bg-blue-50
                text-lg
                text-blue-600
              "
            >
              <ScanFace size={18} strokeWidth={2} />
            </span>

            <span>
              Face Attendance
            </span>

          </Link>


          {role === "ADMIN" && (<>
          {/* Employees */}

          <Link
            to="/employees"
            onClick={closeMobileMenu}
            className={`
              flex items-center
              gap-3
              rounded-xl
              px-3.5 py-3
              text-sm font-semibold
              no-underline
              transition

              ${
                isEmployeesActive
                  ? "bg-blue-50 text-blue-600"
                  : "text-slate-600 hover:bg-slate-50 hover:text-blue-600"
              }
            `}
          >

            <span
              className={`
                flex h-9 w-9
                items-center justify-center
                rounded-lg
                text-lg

                ${
                  isEmployeesActive
                    ? "bg-white text-blue-600 shadow-sm"
                    : "bg-slate-100 text-slate-500"
                }
              `}
            >
              <UsersRound size={18} strokeWidth={2} />
            </span>

            <span>
              Employees
            </span>

          </Link>
          </>)}
{/* Attendance */}

<Link
  to="/attendance"
  onClick={closeMobileMenu}
  className={`
    mb-1
    flex items-center
    gap-3
    rounded-xl
    px-3.5 py-3
    text-sm font-semibold
    no-underline
    transition

    ${
      isAttendanceActive
        ? "bg-blue-50 text-blue-600"
        : "text-slate-600 hover:bg-slate-50 hover:text-blue-600"
    }
  `}
>
  <span
    className={`
      flex h-9 w-9
      items-center justify-center
      rounded-lg
      text-lg

      ${
        isAttendanceActive
          ? "bg-white text-blue-600 shadow-sm"
          : "bg-slate-100 text-slate-500"
      }
    `}
  >
    <CalendarCheck2 size={18} strokeWidth={2} />
  </span>

  <span>
    {role === "ADMIN" ? "Attendance Calendar" : "My Calendar"}
  </span>
</Link>
{role === "ADMIN" && (
  <Link
    to="/schedules"
    onClick={closeMobileMenu}
    className={`mb-1 flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-semibold no-underline transition ${isWorkConfigActive ? "bg-blue-50 text-blue-600" : "text-slate-600 hover:bg-slate-50 hover:text-blue-600"}`}
  >
    <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${isWorkConfigActive ? "bg-white text-blue-600" : "bg-slate-100 text-slate-500"}`}>
      <CalendarDays size={18} strokeWidth={2} />
    </span>
    <span>Shifts & schedules</span>
  </Link>
)}
{role === "ADMIN" && (
  <Link
    to="/users"
    onClick={closeMobileMenu}
    className={`
      mb-1
      flex items-center
      gap-3
      rounded-xl
      px-3.5 py-3
      text-sm font-semibold
      no-underline
      transition

      ${
        isUsersActive
          ? "bg-blue-50 text-blue-600"
          : "text-slate-600 hover:bg-slate-50 hover:text-blue-600"
      }
    `}
  >
    <span
      className={`
        flex h-9 w-9
        items-center justify-center
        rounded-lg
        text-lg

        ${
          isUsersActive
            ? "bg-white text-blue-600 shadow-sm"
            : "bg-slate-100 text-slate-500"
        }
      `}
    >
      <UsersRound size={18} strokeWidth={2} />
    </span>

    <span>
      Users
    </span>
  </Link>
)}
        </nav>


        {/* ===================================================
            USER / LOGOUT
        =================================================== */}

        <div
          className="
            border-t border-slate-100
            p-4
          "
        >

          <Link
            to="/profile"
            onClick={closeMobileMenu}
            aria-label="Open my profile"
            className="mb-3 flex items-center gap-3 rounded-xl bg-slate-50 p-3 no-underline transition hover:bg-blue-50"
          >

            <div
              className="
                flex h-10 w-10
                shrink-0
                items-center justify-center
                rounded-full
                bg-blue-100
                text-sm font-bold
                text-blue-600
              "
            >
              <UserRound size={20} strokeWidth={2} />
            </div>

            <div className="min-w-0">

              <div
                className="
                  truncate
                  text-sm font-bold
                  text-slate-800
                "
              >
                {username}
              </div>

              <div
                className="
                  mt-0.5
                  text-[11px]
                  font-semibold
                  uppercase
                  tracking-wide
                  text-slate-400
                "
              >
                {role}
              </div>

            </div>

          </Link>


          <button
            type="button"
            onClick={handleLogout}
            className="
              flex w-full
              items-center
              justify-center
              gap-2
              rounded-xl
              border border-slate-200
              bg-white
              px-4 py-2.5
              text-sm font-semibold
              text-slate-600
              transition

              hover:border-red-200
              hover:bg-red-50
              hover:text-red-600

              focus:outline-none
              focus:ring-2
              focus:ring-red-100
            "
          >
            <span className="text-base">
              <LogOut size={16} strokeWidth={2} />
            </span>

            Logout
          </button>

        </div>

      </aside>


      {/* =====================================================
          MAIN AREA
      ===================================================== */}

      <div
        className="
          min-h-screen
          lg:pl-64
        "
      >

        {/* ===================================================
            TOPBAR
        =================================================== */}

        <header
          className="
            sticky top-0 z-30
            flex h-16
            items-center
            justify-between
            border-b border-slate-200
            bg-white/95
            px-4
            backdrop-blur
            sm:px-6
            lg:px-8
          "
        >

          {/* Mobile menu button */}

          <button
            type="button"
            onClick={() =>
              setMobileMenuOpen(true)
            }
            className="
              flex h-10 w-10
              items-center justify-center
              rounded-xl
              text-slate-600
              hover:bg-slate-100
              lg:hidden
            "
          >
            ☰
          </button>


          <div
            className="
              hidden
              text-sm font-bold
              text-slate-800
              sm:block
            "
          >
            FaceAttend
          </div>


          <div className="ml-auto flex items-center gap-4">

            {/* System status */}

            <div
              className="
                hidden
                items-center
                gap-2
                text-xs font-semibold
                text-slate-500
                sm:flex
              "
            >

              <span
                className="
                  h-2 w-2
                  rounded-full
                  bg-emerald-500
                  shadow-[0_0_0_3px_rgba(16,185,129,0.12)]
                "
              />

              System Online

            </div>


            {/* User */}

            <Link
              to="/profile"
              aria-label="Open my profile"
              className="flex items-center gap-2 border-l border-slate-200 pl-4 no-underline"
            >

              <div
                className="
                  flex h-8 w-8
                  items-center justify-center
                  rounded-full
                  bg-blue-100
                  text-xs font-bold
                  text-blue-600
                "
              >
                <UserRound size={16} strokeWidth={2} />
              </div>

              <span
                className="
                  hidden
                  text-sm font-semibold
                  text-slate-700
                  md:block
                "
              >
                {username}
              </span>

            </Link>

          </div>

        </header>


        {/* ===================================================
            PAGE CONTENT
        =================================================== */}

        <main
          className="
            min-h-[calc(100vh-4rem)]
            p-4
            sm:p-6
            lg:p-8
          "
        >
          <Outlet />
        </main>

      </div>

    </div>
  );
}