/**
 * 路由注册层。
 *
 * index.ts 只负责 Hono app 的组装（全局中间件、错误处理、静态资源 / SSR 兜底），
 * 所有业务路由的导入与挂载集中在这里。新增路由时只需在本文件登记一次。
 *
 * 目录按域分组：
 *  - core/      题目、提交、竞赛、榜单、标签、题单、训练等判题主线
 *  - community/ 博客、讨论、题解、私信、通知、团队、用户主页
 *  - admin/     管理后台、权限组、审计、站点设置与内容审核
 *  - system/    认证、验证码、搜索、RSS、上传、AI、内部回调等基础设施
 */
import type { Hono } from 'hono';
import type { AppType } from '../types';

import problems from './core/problems';
import submissions from './core/submissions';
import contests from './core/contests';
import rankings from './core/rankings';
import ratings from './core/ratings';
import tags from './core/tags';
import problemLists from './core/problemLists';
import collections from './core/collections';
import training from './core/training';
import notes from './core/notes';
import achievements from './core/achievements';

import users from './community/users';
import blogs from './community/blogs';
import discussions from './community/discussions';
import solutions from './community/solutions';
import messages from './community/messages';
import notifications from './community/notifications';
import teams from './community/teams';
import codeShares from './community/codeShares';

import admin from './admin/admin';
import permissionGroups from './admin/permissionGroups';
import audit from './admin/audit';
import settings from './admin/settings';
import customPages from './admin/customPages';
import announcements from './admin/announcements';
import friendLinks from './admin/friendLinks';
import tickets from './admin/tickets';

import auth from './system/auth';
import captcha from './system/captcha';
import search from './system/search';
import rss from './system/rss';
import templates from './system/templates';
import userSettings from './system/userSettings';
import internal from './system/internal';
import ai from './system/ai';
import uploads from './system/uploads';

/** 把全部业务路由挂载到 /api/v1 子应用上。挂载顺序与重组前保持一致。 */
export function registerRoutes(api: Hono<AppType>): void {
  api.route('/auth', auth);
  api.route('/problems', problems);
  api.route('/submissions', submissions);
  api.route('/rankings', rankings);
  api.route('/users', users);
  api.route('/admin', admin);
  api.route('/permission-groups', permissionGroups);
  api.route('/internal', internal);
  api.route('/contests', contests);
  api.route('/tickets', tickets);
  api.route('/lists', problemLists);
  api.route('/solutions', solutions);
  api.route('/discussions', discussions);
  api.route('/uploads', uploads);
  api.route('/settings', settings);
  api.route('/ai', ai);
  api.route('/audit', audit);
  api.route('/tags', tags);
  api.route('/ratings', ratings);
  api.route('/training', training);
  api.route('/notifications', notifications);
  api.route('/messages', messages);
  api.route('/teams', teams);
  api.route('/blogs', blogs);
  api.route('/captcha', captcha);
  api.route('/notes', notes);
  api.route('/achievements', achievements);
  api.route('/search', search);
  api.route('/templates', templates);
  api.route('/user/settings', userSettings);
  api.route('/collections', collections);
  api.route('/announcements', announcements);
  api.route('/rss', rss);
  api.route('/shares', codeShares);
  api.route('/friend-links', friendLinks);
  api.route('/pages', customPages);
}
