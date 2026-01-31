# SCRAPS Backend API Documentation

This document describes the backend infrastructure for the **SCRAPS: Salvage Contracts & Risk-Adjusted Procurement Service** signaling and stats server.

## Deployment Information
When deployed, all endpoints are accessible via the base URL of the signaling server (e.g., `https://spacerally.supercollider.hr/api/`).

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
    "type": "up" | "down",
    "userId": "string (client-generated)",
    "mode": "timeTrial" | "practice" 
  }
  ```
- **Response**: `{"ok": true}`
- **Notes**:
  - Votes with `mode="practice"` are rejected.
  - If `userId` is provided, the server will best-effort dedupe to one vote per `userId` per `seed`.

### Game Stats (`/api/stats`)
Record mission performance metrics.
- **Method**: `POST`
- **Payload**:
  ```json
  {
    "type": "played" | "finished" | "wrecked",
    "seed": "string",
    "userId": "string (client-generated)",
    "mode": "timeTrial" | "practice",
    "name": "string",
    "scoreMs": 123456,
    "avgSpeedKmH": 123.4
  }
  ```
- **Response**: `{"ok": true}`

### High Scores (`/api/highscores` / `/api/highscore`)
- **Method**: `GET`
  - **Query Params**: `seed` (optional)
  - **Description**: Returns top 10 scores, optionally filtered by seed.
- **Method**: `POST`
  - **Payload**:
    ```json
    {
      "name": "string",
      "score": 123456,
      "seed": "string",
      "userId": "string (client-generated)",
      "mode": "timeTrial" | "practice",
      "avgSpeedKmH": 123.4
    }
    ```
  - **Description**: Submits a new lap time.
- **Notes**:
  - Scores with `mode="practice"` are rejected.
  - The server enforces one score per `userId` per `seed` at the database level (only improvements replace previous times).

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
