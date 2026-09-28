import React, { useState } from 'react';
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  FolderClosed,
  Calendar,
  Sparkles,
  Settings,
  Clock,
  ChevronDown,
  ChevronRight,
  Plus,
} from 'lucide-react';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';
import { Course } from '../../types';
import { formatCourseSidebarLabel } from '../../utils/courseFormatting';

interface SidebarProps {
  currentTab: string;
  onSelectTab: (tab: string, courseId?: string) => void;
  isOpen: boolean;
  onNewAction?: () => void;
  courses?: Course[];
  selectedCourseId?: string;
  onSelectCourse?: (courseId: string) => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  color?: string;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  isOpen,
  onNewAction,
  courses = [],
  selectedCourseId,
  onSelectCourse,
}) => {
  const { isDarkMode } = useWorkspaceAuth();
  const [coursesExpanded, setCoursesExpanded] = useState<boolean>(true);

  const navItems: NavGroup[] = [
    {
      group: 'PANEL DOCENTE',
      items: [
        { id: 'courses', label: 'Mis materias', icon: LayoutDashboard, color: 'text-blue-600' },
        { id: 'classes', label: 'Asistencia y Disposición', icon: Users, color: 'text-emerald-600' },
      ],
    },
    {
      group: 'VINCULACIÓN CLASSROOM',
      items: [
        { id: 'classroom_sync', label: 'Sincronizar con Classroom', icon: GraduationCap, color: 'text-emerald-500' },
      ],
    },
  ];

  if (!isOpen) {
    return (
      <aside
        className={`w-16 border-r flex flex-col items-center py-5 space-y-3 shrink-0 min-h-[calc(100vh-4rem)] h-full transition-all ${
          isDarkMode
            ? 'bg-[#10172A] border-slate-800 text-slate-300'
            : 'bg-white border-neutral-200 text-neutral-600'
        }`}
      >
        {navItems.flatMap((g) => g.items).map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`p-3 rounded-full transition-all relative ${
                isActive
                  ? isDarkMode
                    ? 'bg-blue-600 text-white font-semibold'
                    : 'bg-[#c2e7ff] text-[#001d35]'
                  : isDarkMode
                  ? 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  : 'text-neutral-600 hover:bg-neutral-100'
              }`}
              title={item.label}
            >
              <Icon className="w-5 h-5" />
            </button>
          );
        })}
      </aside>
    );
  }

  return (
    <aside
      className={`w-64 border-r flex flex-col min-h-[calc(100vh-4rem)] h-full select-none shrink-0 transition-all ${
        isDarkMode
          ? 'bg-[#10172A] border-slate-800 text-slate-200'
          : 'bg-white border-neutral-200 text-neutral-700'
      }`}
    >
      {/* Navigation groups without internal scrollbar, extending down to bottom */}
      <div className="flex-1 px-3 py-5 space-y-6">
        {navItems.map((group) => (
          <div key={group.group}>
            <div
              className={`px-3 pb-2 text-[11px] font-bold tracking-wider uppercase ${
                isDarkMode ? 'text-slate-400' : 'text-neutral-500'
              }`}
            >
              {group.group}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = currentTab === item.id;
                const isCoursesItem = item.id === 'courses';

                return (
                  <div key={item.id} className="space-y-1">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onSelectTab(item.id)}
                        className={`flex-1 flex items-center justify-between px-4 py-2.5 rounded-full text-sm font-medium transition-all ${
                          isActive
                            ? isDarkMode
                              ? 'bg-blue-600/30 text-blue-300 font-semibold border border-blue-500/40'
                              : 'bg-[#c2e7ff] text-[#001d35] font-semibold'
                            : isDarkMode
                            ? 'text-slate-300 hover:bg-slate-800/80 active:bg-slate-800'
                            : 'text-neutral-700 hover:bg-neutral-100/90 active:bg-neutral-200/80'
                        }`}
                      >
                        <div className="flex items-center gap-3 truncate">
                          <Icon
                            className={`w-4 h-4 shrink-0 ${
                              item.color ||
                              (isActive
                                ? isDarkMode
                                  ? 'text-blue-400'
                                  : 'text-[#001d35]'
                                : isDarkMode
                                ? 'text-slate-400'
                                : 'text-neutral-500')
                            }`}
                          />
                          <span className="truncate">{item.label}</span>
                        </div>

                        {item.badge && (
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                              isActive
                                ? isDarkMode
                                  ? 'bg-blue-500 text-white'
                                  : 'bg-[#001d35] text-white'
                                : isDarkMode
                                ? 'bg-slate-800 text-slate-300'
                                : 'bg-neutral-100 text-neutral-600'
                            }`}
                          >
                            {item.badge}
                          </span>
                        )}
                      </button>

                      {/* Chevron toggle for courses in Google Classroom style */}
                      {isCoursesItem && courses.length > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setCoursesExpanded((prev) => !prev);
                          }}
                          className={`p-1.5 rounded-full transition-colors ${
                            isDarkMode
                              ? 'text-slate-400 hover:bg-slate-800 hover:text-white'
                              : 'text-neutral-500 hover:bg-neutral-200'
                          }`}
                          title={coursesExpanded ? 'Ocultar materias' : 'Desplegar materias'}
                          aria-label="Alternar materias"
                        >
                          <ChevronDown
                            className={`w-4 h-4 transition-transform duration-200 ${
                              coursesExpanded ? 'rotate-0' : '-rotate-90'
                            }`}
                          />
                        </button>
                      )}
                    </div>

                    {/* Collapsible courses list (Google Classroom style) */}
                    {isCoursesItem && coursesExpanded && courses.length > 0 && (
                      <div className="pl-3 pr-1 py-1 space-y-0.5 ml-3 border-l border-neutral-200 dark:border-slate-800">
                        {courses.map((course) => {
                          const isCourseActive = selectedCourseId === course.id && currentTab !== 'courses';
                          const courseBg = course.color || '#1a73e8';
                          const displayLabel = formatCourseSidebarLabel(course);
                          const initial = displayLabel ? displayLabel.charAt(0).toUpperCase() : (course.name ? course.name.charAt(0).toUpperCase() : 'M');

                          return (
                            <button
                              key={course.id}
                              onClick={() => {
                                if (onSelectCourse) {
                                  onSelectCourse(course.id);
                                } else {
                                  onSelectTab('courses', course.id);
                                }
                              }}
                              className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all text-left ${
                                isCourseActive
                                  ? isDarkMode
                                    ? 'bg-blue-600/30 text-blue-300 font-semibold border border-blue-500/30'
                                    : 'bg-blue-50 text-blue-800 font-semibold border border-blue-200'
                                  : isDarkMode
                                  ? 'text-slate-300 hover:bg-slate-800/60'
                                  : 'text-neutral-600 hover:bg-neutral-100'
                              }`}
                              title={displayLabel}
                            >
                              <span
                                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] text-white font-bold shrink-0 shadow-2xs"
                                style={{ backgroundColor: courseBg }}
                              >
                                {initial}
                              </span>
                              <span className="truncate flex-1">{displayLabel}</span>
                            </button>
                          );
                        })}

                        {onNewAction && (
                          <button
                            onClick={onNewAction}
                            className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium transition-all text-left ${
                              isDarkMode
                                ? 'text-blue-400 hover:bg-slate-800/60'
                                : 'text-blue-600 hover:bg-blue-50'
                            }`}
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Nueva Materia...</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
};
