-- 주간 응모권 랭킹 (공개 RPC)
-- 데일리 체크인 폐지(2026-08-12)로 streak_leaderboard 의 기준(출석 스트릭)이 사라져 이를 대체합니다.
-- tickets = 이번 주(KST 월~일) 승인된 미션 인증 건수 * 5
-- 노출 항목은 streak_leaderboard 와 동일 수준(닉네임 + 집계값)이며 연락처·이메일은 반환하지 않습니다.
CREATE OR REPLACE FUNCTION public.ticket_leaderboard(p_limit integer DEFAULT 10)
RETURNS TABLE(user_id uuid, nickname text, missions integer, tickets integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH wk AS (
    SELECT date_trunc('week', (now() AT TIME ZONE 'Asia/Seoul'))::date AS s
  ),
  agg AS (
    SELECT s.user_id AS uid, count(*)::int AS m
    FROM airdrop_submissions s, wk
    WHERE s.status = 'approved'
      AND s.created_at >= (wk.s::timestamp AT TIME ZONE 'Asia/Seoul')
      AND s.created_at <  ((wk.s + 7)::timestamp AT TIME ZONE 'Asia/Seoul')
    GROUP BY s.user_id
  )
  SELECT agg.uid, p.nickname, agg.m, (agg.m * 5)::int
  FROM agg LEFT JOIN profiles p ON p.id = agg.uid
  ORDER BY agg.m DESC, agg.uid
  LIMIT GREATEST(1, p_limit);
$function$;

GRANT EXECUTE ON FUNCTION public.ticket_leaderboard(integer) TO anon, authenticated;
