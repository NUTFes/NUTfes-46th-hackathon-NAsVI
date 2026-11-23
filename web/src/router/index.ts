import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'map', component: () => import('../views/MapView.vue') },
  { path: '/search', name: 'search', component: () => import('../views/SearchView.vue') },
  { path: '/places/:id', name: 'card', component: () => import('../views/PlaceCard.vue') },
  { path: '/places/:id/tags', name: 'tags', component: () => import('../views/TagsView.vue') },
  { path: '/guide', name: 'guide', component: () => import('../views/GuideView.vue') },
  { path: '/stamp', name: 'stamp', component: () => import('../views/StampView.vue') },
  { path: '/noloc', name: 'noloc', component: () => import('../views/NoLocationView.vue') },
  { path: '/buildings/:id', name: 'building', component: () => import('../views/BuildingView.vue') },
  { path: '/list', name: 'list', component: () => import('../views/ListView.vue') },
  { path: '/camera', name: 'camera', component: () => import('../views/CameraView.vue') },
  {
    path: '/admin',
    component: () => import('../views/admin/AdminLayout.vue'),
    redirect: '/admin/places',
    children: [
      { path: 'places', name: 'admin-places', component: () => import('../views/admin/PlacesAdmin.vue') },
      { path: 'labels', name: 'admin-labels', component: () => import('../views/admin/LabelsAdmin.vue') },
      { path: 'landmarks', name: 'admin-landmarks', component: () => import('../views/admin/LandmarksAdmin.vue') },
      { path: 'floorplans', name: 'admin-floorplans', component: () => import('../views/admin/FloorPlansAdmin.vue') },
    ],
  },
];

export default createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});
