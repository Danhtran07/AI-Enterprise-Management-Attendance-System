import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";

import Attendance from "./pages/Attendance";
import Dashboard from "./pages/Dashboard";
import Employees from "./pages/Employees";
import Login from "./pages/Login";
import Profile from "./pages/Profile";
import Users from "./pages/Users";
import Schedules from "./pages/Schedules";
import App from "./pages/App";
import Layout from "./components/Layout";
import AdminRoute from "./components/AdminRoute";
import ProtectedRoute from "./components/ProtectedRoute";
import "./index.css";

function EmployeeScheduleRedirect() {
  const { employeeId } = useParams();
  return <Navigate to={`/attendance?employee=${employeeId}`} replace />;
}

createRoot(
  document.getElementById("root")!
).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <Navigate
              to={localStorage.getItem("access_token") ? "/dashboard" : "/login"}
              replace
            />
          }
        />
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/recognition" element={<App />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/employees" element={<Employees />} />
            <Route path="/attendance" element={<Attendance />} />
            <Route path="/my-schedule" element={<Navigate to="/attendance" replace />} />
            <Route
              path="/employees/:employeeId/schedule"
              element={
                <AdminRoute>
                  <EmployeeScheduleRedirect />
                </AdminRoute>
              }
            />
            <Route path="/profile" element={<Profile />} />
            <Route
              path="/shifts"
              element={
                <AdminRoute>
                  <Navigate to="/schedules?tab=shifts" replace />
                </AdminRoute>
              }
            />
            <Route path="/schedules" element={<AdminRoute><Schedules /></AdminRoute>} />
            <Route
              path="/users"
              element={
                <AdminRoute>
                  <Users />
                </AdminRoute>
              }
            />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);