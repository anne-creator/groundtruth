# GroundTruth Demo Script

## 1. Opening

Founders often delay high-stakes decisions until it's too late.

GroundTruth gives you a answer with reasoing chain, out of pocket. You text your problem. It takes your company info, has thre3 CEO agents craft plan independetnly, what's more, debate the options, voting and call you for your consent to execute.  

## 2. Product Walkthrough

Let me show you what that looks like.

Here, a founder asks a real operating question: "What should we do about runway?"

GroundTruth immediately pulls in the company context and sends the same problem to three different CEO personas, backed by pholosiphies behind buffet, elon mask and Ray Dalio

Each agent proposes its own plan, with confidence, projected runway, and the evidence behind its reasoning. Then,  the agents debate.

In the next rounds, they review each other's plans, vote, change their minds when the evidence is stronger, and eliminate weaker options.

On the left, we can watch the decision process unfold in real time. In the center, we see each agent's proposal and reasoning. On the right, GroundTruth narrows the debate down to the surviving recommendation.

The important part is that the human is still in control. Once the agents converge, the founder can approve or reject the final plan.

If approved, GroundTruth can trigger the next actions automatically, once we approve the plan, the decision immediately logged ot the notion

## 3. Deep Dive

For the deep dive, there are two sponsor technologies that make this experience possible.

First is Supermemory. The company information is ingested through Supermemory connectors from all resource locations: slack, gamil and notion. so GroundTruth  a one-time prompt. When a founder asks a question never rely on one time prompt.   
  
Each CEO agent retrieves relevant evidence from that memory layer, along with its own persistent profile stored in postsql database. That is why the agents are not just producing three generic opinions.   


Supermemory also lets us keep the system adaptive. New data is auto synced via supermemories , past plans and decisions can be stored back into memory, and the agents can build on what happened before instead of starting from zero every time.

The second key piece is AgentPhone. GroundTruth lives also in founder's pocket. With AgentPhone, a founder can text in a problem, which triggers the workflow through a webhook, exactly like typing inside the dashboard. And founders doesn't need to wait, Once GroundTruth needs founder's to check, it send the plan back via message or call the founder 

Most importantly, the human approval loop also happens through AgentPhone. The founder can instruct Groundtrugh by replying the emssage or answering the phone, and that webhook feeds the decision directly back into the system. So AgentPhone turns GroundTruth from a passive analysis tool into an active decision assistant. After getting the approval, GroundTruth continues its execution.  
  
InsForge is the glue underneath both features: It has a postsql database to store all the agents status, and globla state. the broadcasting functionality ensuer smooth communication and the edge functions connect the Supermemory retrieval, AgentPhone webhooks, live session state, and final execution step into one coordinated flow.

## 4. Next Steps

Next, I want to expand GroundTruth from one decision room into a persistent operating system for founders: more data sources, more execution integrations, and long-term learning from every decision the company makes.