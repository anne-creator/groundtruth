# GroundTruth

GroundTruth is a founder decision engine for high-stakes operating questions. A founder can text in a problem, GroundTruth gathers company context, three CEO agents debate different plans, and the founder approves or rejects the recommendation before execution.

Live demo: [groundtruth-blush.vercel.app](https://groundtruth-blush.vercel.app/)

## How It Works

```mermaid
flowchart LR
    Founder["Founder"]
    Web["Web Dashboard"]
    Phone["AgentPhone"]
    Orchestrator["InsForge Edge Functions"]
    Memory["Supermemory"]
    DB["InsForge Postgres + Realtime"]
    Agents["3 CEO Agents"]
    Approval["Human Approval"]
    Execution["Execution + Notion Log"]

    Founder --> Web
    Founder --> Phone
    Web --> Orchestrator
    Phone --> Orchestrator
    Orchestrator --> Memory
    Orchestrator --> DB
    Memory --> Agents
    DB --> Agents
    Agents --> DB
    DB --> Web
    Agents --> Approval
    Approval --> Orchestrator
    Orchestrator --> Execution
```

## Core Stack

- **Supermemory** provides persistent company memory and evidence retrieval.
- **AgentPhone** lets founders start and approve decisions from their phone.
- **InsForge** handles state, realtime updates, and the orchestration workflow.

## Repository

- `frontend/` contains the React dashboard.
- `insforge/functions/` contains the edge-function workflow.
- `migrations/` contains the database schema.
- `demo-script.md` contains the live demo script.
