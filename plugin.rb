# name: latest-replies
# about: Mostra os últimos comentários na página inicial com queries SQL otimizadas
# version: 1.0.0
# authors: Seu Nome
# url: https://github.com/seuusuario/discourse-latest-replies

enabled_site_setting :latest_replies_enabled

register_asset "stylesheets/latest-replies.scss"

after_initialize do
  module ::LatestReplies
    class Engine < ::Rails::Engine
      engine_name "latest_replies"
      isolate_namespace LatestReplies
    end
  end

  class LatestReplies::LatestRepliesController < ::ApplicationController
    requires_plugin "latest-replies"

    def index
      limit = [params[:limit].to_i, 50].min
      limit = 15 if limit <= 0

      # Query SQL otimizada para buscar os últimos comentários
      sql = <<~SQL
        SELECT 
          p.id,
          p.post_number,
          p.created_at,
          p.updated_at,
          LEFT(p.raw, 300) as excerpt,
          p.topic_id,
          t.title as topic_title,
          t.slug as topic_slug,
          t.category_id,
          c.name as category_name,
          c.color as category_color,
          c.text_color as category_text_color,
          u.id as user_id,
          u.username,
          u.name as display_name,
          u.uploaded_avatar_id,
          ARRAY_AGG(DISTINCT tag.name) FILTER (WHERE tag.name IS NOT NULL) as tags
        FROM posts p
        INNER JOIN topics t ON t.id = p.topic_id
        INNER JOIN users u ON u.id = p.user_id
        LEFT JOIN categories c ON c.id = t.category_id
        LEFT JOIN topic_tags tt ON tt.topic_id = t.id
        LEFT JOIN tags tag ON tag.id = tt.tag_id
        WHERE p.post_number > 1
          AND p.deleted_at IS NULL
          AND t.deleted_at IS NULL
          AND t.archetype = 'regular'
          AND t.visible = true
          AND p.hidden = false
          AND (c.id IS NULL OR c.read_restricted = false OR c.id IN (?))
        GROUP BY p.id, p.post_number, p.created_at, p.updated_at, p.raw, 
                 p.topic_id, t.title, t.slug, t.category_id, c.name, 
                 c.color, c.text_color, u.id, u.username, u.name, u.uploaded_avatar_id
        ORDER BY p.created_at DESC
        LIMIT ?
      SQL

      # Obter categorias que o usuário pode ver
      allowed_category_ids = Guardian.new(current_user).allowed_category_ids

      begin
        results = DB.query(sql, allowed_category_ids, limit)
        
        posts_data = results.map do |row|
          # Processar excerpt removendo HTML e truncando
          excerpt = ActionView::Base.full_sanitizer.sanitize(row.excerpt || "")
          excerpt = truncate_excerpt(excerpt, 120)
          
          # Obter avatar URL
          avatar_url = if row.uploaded_avatar_id
            Discourse.store.get_path_for_upload(row.uploaded_avatar_id)
          else
            "/letter_avatar_proxy/v4/letter/#{row.username.first.upcase}/#{LetterAvatar.color_from_username(row.username)}/45.png"
          end

          {
            id: row.id,
            post_number: row.post_number,
            created_at: row.created_at,
            updated_at: row.updated_at,
            excerpt: excerpt,
            topic_id: row.topic_id,
            topic_title: row.topic_title,
            topic_slug: row.topic_slug,
            username: row.username,
            display_name: row.display_name || row.name || row.username,
            avatar_url: avatar_url,
            category: row.category_name ? {
              id: row.category_id,
              name: row.category_name,
              color: row.category_color,
              text_color: row.category_text_color
            } : nil,
            tags: row.tags || []
          }
        end

        render json: {
          posts: posts_data,
          success: true
        }
      rescue => e
        Rails.logger.error "Erro ao buscar últimos comentários: #{e.message}"
        render json: { 
          posts: [], 
          success: false, 
          error: "Erro interno do servidor" 
        }, status: 500
      end
    end

    private

    def truncate_excerpt(text, max_length)
      return "" if text.blank?
      return text if text.length <= max_length
      
      truncated = text[0...max_length]
      last_space = truncated.rindex(' ')
      
      if last_space && last_space > max_length * 0.8
        truncated[0...last_space] + "..."
      else
        truncated + "..."
      end
    end
  end

  # Registrar rotas
  Discourse::Application.routes.append do
    get '/latest-replies' => 'latest_replies/latest_replies#index'
  end
end