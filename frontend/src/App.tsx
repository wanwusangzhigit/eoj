import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, lazy, Suspense } from 'react';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import { t } from './i18n';
import { useAuthStore } from './store/auth';
import './styles/global.css';
import './styles/components.css';

const ProblemList = lazy(() => import('./pages/ProblemList'));
const Home = lazy(() => import('./pages/Home'));
const ProblemDetail = lazy(() => import('./pages/ProblemDetail'));
const Submissions = lazy(() => import('./pages/Submissions'));
const SubmissionDetail = lazy(() => import('./pages/SubmissionDetail'));
const Rankings = lazy(() => import('./pages/Rankings'));
const Profile = lazy(() => import('./pages/Profile'));
const Favorites = lazy(() => import('./pages/Favorites'));
const Login = lazy(() => import('./pages/Login'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminCreateProblem = lazy(() => import('./pages/admin/AdminCreateProblem'));
const AdminProblems = lazy(() => import('./pages/admin/AdminProblems'));
const AdminTestcases = lazy(() => import('./pages/admin/AdminTestcases'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const AdminContests = lazy(() => import('./pages/admin/AdminContests'));
const AdminTickets = lazy(() => import('./pages/admin/AdminTickets'));
const AdminLists = lazy(() => import('./pages/admin/AdminLists'));
const AdminAnnouncement = lazy(() => import('./pages/admin/AdminAnnouncement'));
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings'));
const AdminModels = lazy(() => import('./pages/admin/AdminModels'));
const AdminUploads = lazy(() => import('./pages/admin/AdminUploads'));
const AdminSql = lazy(() => import('./pages/admin/AdminSql'));
const AdminAuditLogs = lazy(() => import('./pages/admin/AdminAuditLogs'));
const AdminBans = lazy(() => import('./pages/admin/AdminBans'));
const NotFound = lazy(() => import('./pages/NotFound'));
const Contests = lazy(() => import('./pages/Contests'));
const ContestDetail = lazy(() => import('./pages/ContestDetail'));
const Tickets = lazy(() => import('./pages/Tickets'));
const CreateTicket = lazy(() => import('./pages/CreateTicket'));
const TicketDetail = lazy(() => import('./pages/TicketDetail'));
const ProblemLists = lazy(() => import('./pages/ProblemLists'));
const ProblemListDetail = lazy(() => import('./pages/ProblemListDetail'));
const CreateProblemList = lazy(() => import('./pages/CreateProblemList'));
const CreateContest = lazy(() => import('./pages/CreateContest'));
const Solutions = lazy(() => import('./pages/Solutions'));
const SolutionDetail = lazy(() => import('./pages/SolutionDetail'));
const Discussions = lazy(() => import('./pages/Discussions'));
const DiscussionDetail = lazy(() => import('./pages/DiscussionDetail'));
const GlobalSolutions = lazy(() => import('./pages/GlobalSolutions'));
const GlobalDiscussions = lazy(() => import('./pages/GlobalDiscussions'));
const MyFiles = lazy(() => import('./pages/MyFiles'));
const AIChat = lazy(() => import('./pages/AIChat'));
const Training = lazy(() => import('./pages/Training'));
const TrainingDetail = lazy(() => import('./pages/TrainingDetail'));
const AdminTraining = lazy(() => import('./pages/admin/AdminTraining'));
const AdminPlagiarism = lazy(() => import('./pages/admin/AdminPlagiarism'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Messages = lazy(() => import('./pages/Messages'));
const FollowList = lazy(() => import('./pages/FollowList'));
const Teams = lazy(() => import('./pages/Teams'));
const TeamDetail = lazy(() => import('./pages/TeamDetail'));
const CreateTeam = lazy(() => import('./pages/CreateTeam'));
const Blogs = lazy(() => import('./pages/Blogs'));
const BlogDetail = lazy(() => import('./pages/BlogDetail'));
const BlogEditor = lazy(() => import('./pages/BlogEditor'));
const AdminSolutionReview = lazy(() => import('./pages/admin/AdminSolutionReview'));
const AdminReports = lazy(() => import('./pages/admin/AdminReports'));
const AdminBlogs = lazy(() => import('./pages/admin/AdminBlogs'));
const AdminTeams = lazy(() => import('./pages/admin/AdminTeams'));
const AdminMessages = lazy(() => import('./pages/admin/AdminMessages'));
const AdminAds = lazy(() => import('./pages/admin/AdminAds'));
const Privacy = lazy(() => import('./pages/Privacy'));
const Terms = lazy(() => import('./pages/Terms'));
const Contact = lazy(() => import('./pages/Contact'));

function App() {
  const { fetchUser, token } = useAuthStore();

  useEffect(() => {
    if (token) {
      fetchUser();
    }
  }, [token, fetchUser]);

  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Layout>
          <Suspense fallback={<div className="loading-container"><div className="loading-spinner"></div><p>{t('common.loading')}</p></div>}>
            <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/problems" element={<ProblemList />} />
            <Route path="/problems/:slug" element={<ProblemDetail />} />
            <Route path="/submissions" element={<Submissions />} />
            <Route path="/submissions/:id" element={<SubmissionDetail />} />
            <Route path="/rankings" element={<Rankings />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/users/:username" element={<Profile />} />
            <Route path="/favorites" element={<Favorites />} />
            <Route path="/login" element={<Login />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<AdminDashboard />} />
              <Route path="create-problem" element={<AdminCreateProblem />} />
              <Route path="problems" element={<AdminProblems />} />
              <Route path="testcases" element={<AdminTestcases />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="contests" element={<AdminContests />} />
              <Route path="tickets" element={<AdminTickets />} />
              <Route path="lists" element={<AdminLists />} />
              <Route path="announcement" element={<AdminAnnouncement />} />
              <Route path="settings" element={<AdminSettings />} />
              <Route path="models" element={<AdminModels />} />
              <Route path="uploads" element={<AdminUploads />} />
              <Route path="sql" element={<AdminSql />} />
              <Route path="audit-logs" element={<AdminAuditLogs />} />
              <Route path="bans" element={<AdminBans />} />
              <Route path="training" element={<AdminTraining />} />
              <Route path="plagiarism" element={<AdminPlagiarism />} />
              <Route path="solution-review" element={<AdminSolutionReview />} />
              <Route path="reports" element={<AdminReports />} />
              <Route path="blogs" element={<AdminBlogs />} />
              <Route path="teams" element={<AdminTeams />} />
              <Route path="messages" element={<AdminMessages />} />
              <Route path="ads" element={<AdminAds />} />
            </Route>
            <Route path="/contests" element={<Contests />} />
            <Route path="/contests/new" element={<CreateContest />} />
            <Route path="/contests/:id/edit" element={<CreateContest />} />
            <Route path="/contests/:id" element={<ContestDetail />} />
            <Route path="/tickets" element={<Tickets />} />
            <Route path="/tickets/new" element={<CreateTicket />} />
            <Route path="/tickets/:id" element={<TicketDetail />} />
            <Route path="/lists" element={<ProblemLists />} />
            <Route path="/lists/new" element={<CreateProblemList />} />
            <Route path="/lists/:id" element={<ProblemListDetail />} />
            <Route path="/solutions/all" element={<GlobalSolutions />} />
            <Route path="/solutions/:id" element={<SolutionDetail />} />
            <Route path="/solutions" element={<Solutions />} />
            <Route path="/discussions/all" element={<GlobalDiscussions />} />
            <Route path="/discussions/:id" element={<DiscussionDetail />} />
            <Route path="/discussions" element={<Discussions />} />
            <Route path="/my-files" element={<MyFiles />} />
            <Route path="/ai" element={<AIChat />} />
            <Route path="/training" element={<Training />} />
            <Route path="/training/:id" element={<TrainingDetail />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/messages/:id" element={<Messages />} />
            <Route path="/users/:username/followers" element={<FollowList />} />
            <Route path="/users/:username/following" element={<FollowList />} />
            <Route path="/teams" element={<Teams />} />
            <Route path="/teams/new" element={<CreateTeam />} />
            <Route path="/teams/:slug" element={<TeamDetail />} />
            <Route path="/blogs" element={<Blogs />} />
            <Route path="/blogs/:id" element={<BlogDetail />} />
            <Route path="/blog/write" element={<BlogEditor />} />
            <Route path="/blog/:id/edit" element={<BlogEditor />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </Layout>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

export default App;
