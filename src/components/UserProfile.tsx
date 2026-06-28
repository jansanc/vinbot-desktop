import React from "react";
import { AuthUser } from "../services/auth.service";

interface UserProfileProps {
  user: AuthUser;
  onLogout: () => Promise<void>;
  isLoggingOut: boolean;
}

export default function UserProfile({
  user,
  onLogout,
  isLoggingOut,
}: UserProfileProps) {
  const getRoleColor = (role: string): string => {
    const colors: Record<string, string> = {
      free: "#cbd5e0",
      normal: "#bee3f8",
      premium: "#fef08a",
      elite: "#ddd6fe",
      admin: "#fecaca",
    };
    return colors[role] || "#cbd5e0";
  };

  const getRoleEmoji = (role: string): string => {
    const emojis: Record<string, string> = {
      free: "🆓",
      normal: "👤",
      premium: "⭐",
      elite: "👑",
      admin: "🛡️",
    };
    return emojis[role] || "👤";
  };

  return (
    <div className="profile-container">
      <div className="profile-card">
        <div className="profile-header">
          <div className="profile-avatar">
            {user.firstName.charAt(0).toUpperCase()}
          </div>
          <div className="profile-info">
            <h2 className="profile-name">
              {user.firstName} {user.lastName}
            </h2>
            <p className="profile-email">{user.email}</p>
          </div>
        </div>

        <div className="profile-details">
          <div className="detail-row">
            <span className="detail-label">User ID</span>
            <span className="detail-value">{user.id}</span>
          </div>

          <div className="detail-row">
            <span className="detail-label">Role</span>
            <span
              className="detail-value role-badge"
              style={{ backgroundColor: getRoleColor(user.role) }}
            >
              {getRoleEmoji(user.role)} {user.role.toUpperCase()}
            </span>
          </div>

          {user.subscriptionTier && (
            <div className="detail-row">
              <span className="detail-label">Subscription</span>
              <span className="detail-value subscription">
                {user.subscriptionTier}
              </span>
            </div>
          )}

          {user.billingOverdue && (
            <div className="detail-row warning">
              <span className="detail-label">⚠️ Billing Status</span>
              <span className="detail-value">Overdue</span>
            </div>
          )}

          <div className="detail-row">
            <span className="detail-label">AI Token Budget</span>
            <div className="budget-info">
              <div className="budget-bar">
                <div
                  className="budget-used"
                  style={{
                    width: `${Math.round(
                      (user.aiTokenBudget.used /
                        user.aiTokenBudget.monthly) *
                        100
                    )}%`,
                  }}
                ></div>
              </div>
              <span className="budget-text">
                {user.aiTokenBudget.remaining} / {user.aiTokenBudget.monthly}{" "}
                tokens
              </span>
            </div>
          </div>
        </div>

        <div className="profile-actions">
          <button
            className="btn btn-logout"
            onClick={onLogout}
            disabled={isLoggingOut}
          >
            {isLoggingOut ? (
              <>
                <span className="spinner"></span>
                Logging out...
              </>
            ) : (
              "Sign Out"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
