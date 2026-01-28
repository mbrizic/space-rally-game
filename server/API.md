# SCRAPS Backend API Documentation

This document describes the backend infrastructure for the **SCRAPS: Salvage Contracts & Risk-Adjusted Procurement Service** signaling and stats server.

## Deployment Information
When deployed, all endpoints are accessible via the base URL of the signaling server (e.g., `https://signaling.spacerally.supercollider.hr`).

## Public Pages

### Landing Page (`/api/landing`)
The official SCRAPS contractor training portal.
- **Method**: `GET`
- **Description**: Displays lore, mission briefings, and links to play or view stats.

### Stats Dashboard (`/api/stats`)
Real-time telemetry and leaderboard.
- **Method**: `GET`
- **Description**: Displays daily games played, total completed/wrecked races, global high scores, and track popularity (likes/dislikes).

---

## API Endpoints

### Track Voting (`/api/vote`)
Record contractor feedback on track seeds.
- **Method**: `POST`
- **Payload**:
  ```json
  {
    "seed": "string",
    "type": "up" | "down"
  }
  ```
- **Response**: `{"ok": true}`

### Game Stats (`/api/stats`)
Record mission performance metrics.
- **Method**: `POST`
- **Payload**:
  ```json
  {
    "type": "played" | "finished" | "wrecked"
  }
  ```
- **Response**: `{"ok": true}`

### High Scores (`/api/high-scores`)
- **Method**: `GET`
  - **Query Params**: `seed` (optional)
  - **Description**: Returns top 10 scores, optionally filtered by seed.
- **Method**: `POST`
  - **Payload**: `{"name": "string", "score": number, "seed": "string"}`
  - **Description**: Submits a new lap time.

### Secure Backups (`/api/backup`)
Hot backup of the SQLite database.
- **Method**: `GET`
- **Description**: Returns a point-in-time copy of the `scores.sqlite` database using SQLite's atomic `VACUUM INTO`.
- **Note**: This is intended for administrator use.

---

## Maintenance Tools
In the `server/` directory, you can find `backup.sh`. This script automates the retrieval of database backups:
```bash
./backup.sh
```
It will save a timestamped `.sqlite` file in the `server/backups/` directory.
