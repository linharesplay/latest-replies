import { withPluginApi } from "discourse/lib/plugin-api";

function initializeLatestReplies(api) {
  api.onPageChange((url) => {
    if (url === "/" || url === "/latest" || url === "/categories") {
      initLatestRepliesWidget();
    } else {
      cleanupLatestReplies();
    }
  });
}

function initLatestRepliesWidget() {
  if (!Discourse.SiteSettings.latest_replies_enabled) return;
  if (window.latestRepliesInitialized) return;
  
  const containers = [
    document.querySelector(".category-list"),
    document.querySelector(".topic-list-container"),
    document.querySelector("#list-area")
  ];
  
  const container = containers.find(c => c !== null);
  if (!container) return;
  
  window.latestRepliesInitialized = true;

  class LatestRepliesManager {
    constructor() {
      this.pollingInterval = Discourse.SiteSettings.latest_replies_refresh_interval || 30000;
      this.limit = Discourse.SiteSettings.latest_replies_limit || 15;
      this.pollingIntervalId = null;
      this.isLoading = false;
      this.lastFetchTime = 0;
      this.cache = new Map();
      this.cacheTimeout = 5 * 60 * 1000; // 5 minutos
    }

    timeAgo(dateString) {
      const now = new Date();
      const postDate = new Date(dateString);
      const diffMs = now - postDate;

      const seconds = Math.floor(diffMs / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      const weeks = Math.floor(days / 7);
      const months = Math.floor(days / 30);

      if (months > 0) return `há ${months} mês${months > 1 ? "es" : ""}`;
      if (weeks > 0) return `há ${weeks} semana${weeks > 1 ? "s" : ""}`;
      if (days > 0) return `há ${days} dia${days > 1 ? "s" : ""}`;
      if (hours > 0) return `há ${hours} hora${hours > 1 ? "s" : ""}`;
      if (minutes > 0) return `há ${minutes} minuto${minutes > 1 ? "s" : ""}`;
      if (seconds > 30) return `há ${seconds} segundo${seconds > 1 ? "s" : ""}`;
      return "agora mesmo";
    }

    getCachedData(key) {
      const cached = this.cache.get(key);
      if (!cached) return null;
      
      if (Date.now() - cached.timestamp > this.cacheTimeout) {
        this.cache.delete(key);
        return null;
      }
      
      return cached.data;
    }

    setCachedData(key, data) {
      this.cache.set(key, {
        data: data,
        timestamp: Date.now()
      });
    }

    async loadLatestReplies(forceRefresh = false) {
      if (this.isLoading) return;
      
      const cacheKey = `latest_replies_${this.limit}`;
      
      if (!forceRefresh) {
        const cached = this.getCachedData(cacheKey);
        if (cached) {
          this.renderLatestReplies(cached);
          return;
        }
      }

      this.isLoading = true;

      try {
        const response = await fetch(`/latest-replies?limit=${this.limit}`, {
          headers: {
            'X-Requested-With': 'XMLHttpRequest'
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success && data.posts) {
          this.setCachedData(cacheKey, data.posts);
          this.renderLatestReplies(data.posts);
          this.lastFetchTime = Date.now();
        }
      } catch (error) {
        console.error("Erro ao carregar últimos comentários:", error);
      } finally {
        this.isLoading = false;
      }
    }

    renderLatestReplies(posts) {
      if (!posts || posts.length === 0) return;

      const rows = posts.map(post => {
        const url = `/t/${post.topic_slug}/${post.topic_id}/${post.post_number}`;
        const timePosted = this.timeAgo(post.created_at);
        const fullDate = new Date(post.created_at).toLocaleString('pt-BR');

        const categoryHtml = (post.category && Discourse.SiteSettings.latest_replies_show_category)
          ? `<span class="latest-replies-category" style="
              background-color: #${post.category.color};
              color: #${post.category.text_color || 'ffffff'};
            ">${post.category.name}</span>` : '';

        const tagsHtml = (post.tags.length > 0 && Discourse.SiteSettings.latest_replies_show_tags)
          ? post.tags.slice(0, 3).map(tag => 
              `<span class="latest-replies-tag">${Handlebars.escapeExpression(tag)}</span>`
            ).join("") : '';

        return `
          <tr class="latest-replies-item" data-post-id="${post.id}">
            <td class="latest-replies-content">
              <div class="latest-replies-row">
                <div class="latest-replies-avatar">
                  <a href="/u/${post.username}" title="Ver perfil de ${Handlebars.escapeExpression(post.display_name)}">
                    <img loading="lazy" 
                         width="45" 
                         height="45" 
                         src="${post.avatar_url}" 
                         class="avatar" 
                         alt="Avatar de ${Handlebars.escapeExpression(post.display_name)}">
                  </a>
                </div>
                <div class="latest-replies-main">
                  <div class="latest-replies-excerpt">
                    <a href="${url}" 
                       class="latest-replies-link" 
                       title="${Handlebars.escapeExpression(post.excerpt)}">${Handlebars.escapeExpression(post.excerpt)}</a>
                  </div>
                  <div class="latest-replies-meta">
                    <a href="/u/${post.username}" 
                       class="latest-replies-user"
                       title="Ver perfil de ${Handlebars.escapeExpression(post.display_name)}">
                      <i class="fa fa-user"></i>
                      @${post.username}
                    </a>
                    ${categoryHtml}
                    ${tagsHtml}
                    <span class="latest-replies-time" title="${fullDate}">
                      <i class="fa fa-clock-o"></i>
                      ${timePosted}
                    </span>
                  </div>
                </div>
              </div>
            </td>
          </tr>
        `;
      }).join("");

      // Remove container existente
      const existingContainer = document.querySelector(".latest-replies-widget");
      if (existingContainer) {
        existingContainer.remove();
      }

      const widget = document.createElement("div");
      widget.className = "latest-replies-widget";
      
      widget.innerHTML = `
        <table class="latest-replies-table">
          <thead>
            <tr>
              <th class="latest-replies-header">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12,3C6.5,3 2,6.58 2,11C2.05,13.15 3.06,15.17 4.75,16.5C4.75,17.1 4.33,18.67 2,21C4.37,20.89 6.64,20 8.47,18.5C9.61,18.83 10.81,19 12,19C17.5,19 22,15.42 22,11C22,6.58 17.5,3 12,3M12,17C7.58,17 4,14.31 4,11C4,7.69 7.58,5 12,5C16.42,5 20,7.69 20,11C20,14.31 16.42,17 12,17Z" />
                </svg>
                Últimos Comentários
              </th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      `;

      container.parentNode.insertBefore(widget, container.nextSibling);
    }

    startPolling() {
      if (this.pollingIntervalId) return;
      
      this.pollingIntervalId = setInterval(() => {
        if (document.visibilityState === 'visible' && !this.isLoading) {
          this.loadLatestReplies(false);
        }
      }, this.pollingInterval);
    }

    stopPolling() {
      if (this.pollingIntervalId) {
        clearInterval(this.pollingIntervalId);
        this.pollingIntervalId = null;
      }
    }

    init() {
      this.loadLatestReplies(false);
      this.startPolling();
    }

    destroy() {
      this.stopPolling();
      this.cache.clear();
    }
  }

  window.latestRepliesManager = new LatestRepliesManager();
  window.latestRepliesManager.init();
}

function cleanupLatestReplies() {
  if (window.latestRepliesManager) {
    window.latestRepliesManager.destroy();
    window.latestRepliesManager = null;
  }
  
  const widget = document.querySelector(".latest-replies-widget");
  if (widget) {
    widget.remove();
  }
  
  window.latestRepliesInitialized = false;
}

export default {
  name: "latest-replies",
  initialize() {
    withPluginApi("0.11.1", initializeLatestReplies);
  }
};