const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});


async function query(text, params) {
  const res = await pool.query(text, params);
  return res;
}

// =============== LOADERS (startup) ===============

async function loadAllCommunities() {
    // 1. Carrega comunidades
    const commsRes = await query(
      "SELECT group_id, title, admin_id FROM communities",
      []
    );
  
    const communities = {};
    const adminsCommunities = {};
  
    for (const row of commsRes.rows) {
      const groupIdNum = Number(row.group_id);
      const adminIdNum = row.admin_id !== null ? Number(row.admin_id) : null;
      const groupIdStr = String(groupIdNum); // usamos string como chave do objeto communities
  
      communities[groupIdStr] = {
        title: row.title,
        adminId: adminIdNum, // sempre Number ou null
        voters: {},
        proposals: [],
        proposalCounter: 1,
      };
  
      // monta adminsCommunities[adminId] = Map(groupId -> { title })
      if (adminIdNum !== null) {
        if (!adminsCommunities[adminIdNum]) {
          adminsCommunities[adminIdNum] = new Map();
        }
        adminsCommunities[adminIdNum].set(groupIdNum, {
          title: row.title,
        });
      }
    }
  
    // 2. Carrega counters
    const countersRes = await query(
      "SELECT group_id, counter FROM proposal_counters",
      []
    );
    for (const row of countersRes.rows) {
      const gidStr = String(row.group_id);
      if (communities[gidStr]) {
        communities[gidStr].proposalCounter = row.counter;
      }
    }
  
    // 3. Carrega voters
    const votersRes = await query(
      `SELECT group_id, user_id, username, approved, weight, processed,
              wallet_address, last_change_reason, last_modified_at
       FROM voters`,
      []
    );
    for (const v of votersRes.rows) {
      const gidStr = String(v.group_id);
      if (!communities[gidStr]) continue;
  
      const uidNum = Number(v.user_id);
  
      communities[gidStr].voters[uidNum] = {
        approved: v.approved,
        weight: v.weight,
        processed: v.processed,
        username: v.username,
        walletAddress: v.wallet_address,
        lastChangeReason: v.last_change_reason,
        lastModifiedAt: v.last_modified_at
          ? (typeof v.last_modified_at === "string"
              ? v.last_modified_at
              : new Date(v.last_modified_at).toISOString())
          : null,
      };
    }
  
    // 4. Carrega proposals
    const propsRes = await query(
      `SELECT group_id, proposal_id, title, options, votes, voter_map,
              status, quorum_weight, ends_at, created_by,
              attachment_file_id, attachment_file_name
       FROM proposals`,
      []
    );
  
    for (const p of propsRes.rows) {
      const gidStr = String(p.group_id);
      if (!communities[gidStr]) continue;
  
      communities[gidStr].proposals.push({
        id: Number(p.proposal_id),
        title: p.title,
        options: Array.isArray(p.options) ? p.options : [], // sanity
        votes: p.votes || {}, // já vem como objeto jsonb
        voterMap: p.voter_map || {},
        status: p.status,
        quorumWeight: p.quorum_weight,
        endsAt: p.ends_at === null ? null : Number(p.ends_at),
        createdBy: p.created_by ? Number(p.created_by) : null,
        attachmentFileId: p.attachment_file_id,
        attachmentFileName: p.attachment_file_name,
      });
    }
  
    // garantir ordenação previsível de proposals
    for (const comm of Object.values(communities)) {
      comm.proposals.sort((a, b) => a.id - b.id);
    }
  
    return { communities, adminsCommunities };
  }
  
  
// =============== WRITERS (mutations) ===============

// cria ou atualiza comunidade
async function upsertCommunity(groupId, title, adminId) {
  await query(
    `INSERT INTO communities (group_id, title, admin_id)
     VALUES ($1,$2,$3)
     ON CONFLICT (group_id)
     DO UPDATE SET title = EXCLUDED.title,
                   admin_id = EXCLUDED.admin_id`,
    [groupId, title, adminId]
  );

  // garantir que tenha counter
  await query(
    `INSERT INTO proposal_counters (group_id, counter)
     VALUES ($1, $2)
     ON CONFLICT (group_id)
     DO NOTHING`,
    [groupId, 1]
  );
}

// atualiza contador de proposta
async function updateProposalCounter(groupId, counter) {
  await query(
    `UPDATE proposal_counters
     SET counter = $2
     WHERE group_id = $1`,
    [groupId, counter]
  );
}

// salva/atualiza voter
async function upsertVoter(groupId, userId, record) {
  await query(
    `INSERT INTO voters
      (group_id, user_id, username, approved, weight, processed, wallet_address, last_change_reason, last_modified_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (group_id, user_id)
     DO UPDATE SET
       username = EXCLUDED.username,
       approved = EXCLUDED.approved,
       weight = EXCLUDED.weight,
       processed = EXCLUDED.processed,
       wallet_address = EXCLUDED.wallet_address,
       last_change_reason = EXCLUDED.last_change_reason,
       last_modified_at = EXCLUDED.last_modified_at`,
    [
      groupId,
      userId,
      record.username || null,
      record.approved || false,
      record.weight,
      record.processed || false,
      record.walletAddress || null,
      record.lastChangeReason || null,
      record.lastModifiedAt || null,
    ]
  );
}

// salva/atualiza proposta inteira
async function upsertProposal(groupId, proposalObj) {
    // garante JSON válido pro Postgres
    const optionsJson = JSON.stringify(proposalObj.options || []);
    const votesJson = JSON.stringify(proposalObj.votes || {});
    const voterMapJson = JSON.stringify(proposalObj.voterMap || {});
  
    await query(
      `INSERT INTO proposals
        (group_id,
         proposal_id,
         title,
         options,
         votes,
         voter_map,
         status,
         quorum_weight,
         ends_at,
         created_by,
         attachment_file_id,
         attachment_file_name)
       VALUES (
         $1,
         $2,
         $3,
         $4::jsonb,
         $5::jsonb,
         $6::jsonb,
         $7,
         $8,
         $9,
         $10,
         $11,
         $12
       )
       ON CONFLICT (group_id, proposal_id)
       DO UPDATE SET
         title = EXCLUDED.title,
         options = EXCLUDED.options,
         votes = EXCLUDED.votes,
         voter_map = EXCLUDED.voter_map,
         status = EXCLUDED.status,
         quorum_weight = EXCLUDED.quorum_weight,
         ends_at = EXCLUDED.ends_at,
         created_by = EXCLUDED.created_by,
         attachment_file_id = EXCLUDED.attachment_file_id,
         attachment_file_name = EXCLUDED.attachment_file_name`,
      [
        groupId,
        proposalObj.id,
        proposalObj.title,
        optionsJson,
        votesJson,
        voterMapJson,
        proposalObj.status,
        proposalObj.quorumWeight,
        proposalObj.endsAt,
        proposalObj.createdBy,
        proposalObj.attachmentFileId,
        proposalObj.attachmentFileName,
      ]
    );
  }
  

module.exports = {
  query,
  loadAllCommunities,
  upsertCommunity,
  updateProposalCounter,
  upsertVoter,
  upsertProposal,
};
