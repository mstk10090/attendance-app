// src/components/RequireAdmin.jsx
import React from "react";
import { Navigate } from "react-router-dom";

export default function RequireAdmin({ children }) {
  const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
  const role = localStorage.getItem("role");

  if (!isLoggedIn) return <Navigate to="/login" replace />;

  if (role !== "admin") return <Navigate to="/mypage" replace />;

  return <>{children}</>;
}
