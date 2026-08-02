package service

import (
	"context"
	"strings"

	"lark/domain/po"
	"lark/pkg/common/xmysql"
	"lark/pkg/proto/pb_user"
)

func (s *userService) SearchUser(ctx context.Context, req *pb_user.SearchUserReq) (resp *pb_user.SearchUserResp, _ error) {
	resp = &pb_user.SearchUserResp{List: make([]*pb_user.UserSummary, 0)}
	keyword := strings.TrimSpace(req.Query)
	if keyword == "" {
		return
	}

	limit := int(req.Size)
	if limit <= 0 || limit > 50 {
		limit = 20
	}

	like := "%" + strings.ReplaceAll(keyword, "%", "\\%") + "%"
	db := xmysql.GetDB().Model(po.User{}).
		Where("deleted_ts=0 AND uid > ? AND uid <> ? AND (mobile = ? OR lark_id = ? OR nickname LIKE ?)",
			req.LastUid,
			req.Uid,
			keyword,
			keyword,
			like)

	_ = db.Count(&resp.Total).Error
	_ = db.Select("uid,lark_id,status,nickname,avatar,gender,birth_ts,city_id").
		Order("uid ASC").
		Limit(limit).
		Find(&resp.List).Error
	return
}
